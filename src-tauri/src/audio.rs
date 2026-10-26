//! Playback devices: which ones there are, which one is the default, and
//! switching between them from the peninsula.
//!
//! On Windows the list comes from WinRT device enumeration, which also tells
//! us each device's form factor (headphones, speakers…) and which physical
//! device it belongs to, so a Bluetooth headset's battery can be read too.
//! Changes arrive as events and are pushed to the frontend as
//! `audio://devices`; the battery is the only thing re-read on a timer.
//!
//! Windows has no public API for changing the default device. Like
//! SoundSwitch and EarTrumpet, this uses the undocumented `IPolicyConfig`
//! interface, which has been stable since Windows 7.

use serde::Serialize;

/// Event name the frontend listens to.
#[cfg_attr(not(windows), allow(dead_code))]
pub const DEVICES_EVENT: &str = "audio://devices";

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    /// Core Audio endpoint id, passed back to `set_default`.
    pub id: String,
    /// What Windows calls it, e.g. "Headphones (AirPods Pro)".
    pub name: String,
    /// "headphones", "headset", "speakers" or "other".
    pub kind: String,
    pub is_default: bool,
    pub bluetooth: bool,
    /// Battery in percent, when the headset reports one to Windows.
    pub battery: Option<u8>,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioState {
    /// False on platforms without device support.
    pub available: bool,
    pub devices: Vec<AudioDevice>,
}

#[cfg(windows)]
pub use windows_impl::{init, set_default, snapshot};

#[cfg(not(windows))]
pub use fallback::{init, set_default, snapshot};

#[cfg(not(windows))]
mod fallback {
    use super::AudioState;

    pub fn init(_app: &tauri::AppHandle) {}

    pub fn snapshot() -> AudioState {
        AudioState::default()
    }

    pub fn set_default(_id: &str) -> Result<(), String> {
        Err("Switching audio devices is only available on Windows".into())
    }
}

#[cfg(windows)]
#[allow(non_snake_case)]
mod windows_impl {
    use super::{AudioDevice, AudioState, DEVICES_EVENT};
    use std::ffi::c_void;
    use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
    use std::sync::{Mutex, OnceLock};
    use std::time::Duration;
    use tauri::{AppHandle, Emitter};
    use windows_core::{interface, IInspectable, IUnknown, IUnknown_Vtbl, Interface, GUID, HRESULT, HSTRING, PCWSTR};
    use windows::Devices::Enumeration::{DeviceInformation, DeviceInformationKind, DeviceWatcher};
    use windows::Foundation::{IReference, TypedEventHandler};
    use windows::Media::Devices::{AudioDeviceRole, MediaDevice};
    use windows::Win32::Media::Audio::{eCommunications, eConsole, eMultimedia, ERole};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};
    use windows_collections::IIterable;

    /// PKEY_AudioEndpoint_FormFactor.
    const FORM_FACTOR: &str = "{1da5d803-d492-4edd-8c23-e0c0ffee7f0e} 0";
    const CONTAINER_ID: &str = "System.Devices.ContainerId";
    /// DEVPKEY_Bluetooth_Battery: what the Bluetooth settings page shows.
    const BATTERY: &str = "{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2";
    /// Everything built into the computer shares this container.
    const COMPUTER_CONTAINER: GUID = GUID::from_u128(0x00000000_0000_0000_ffff_ffffffffffff);

    /// Batteries don't announce changes, so they are re-read this often.
    const BATTERY_REFRESH: Duration = Duration::from_secs(60);
    /// Devices change in bursts (a headset brings several endpoints at once).
    const SETTLE: Duration = Duration::from_millis(300);

    const POLICY_CONFIG_CLSID: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);

    /// Undocumented, but the same on Windows 7 through 11. Only
    /// `SetDefaultEndpoint` is called; the rest just hold their vtable slots.
    #[interface("f8679f50-850a-41cf-9c72-430f290290c8")]
    unsafe trait IPolicyConfig: IUnknown {
        fn GetMixFormat(&self, device: PCWSTR, format: *mut *mut c_void) -> HRESULT;
        fn GetDeviceFormat(&self, device: PCWSTR, default: i32, format: *mut *mut c_void) -> HRESULT;
        fn ResetDeviceFormat(&self, device: PCWSTR) -> HRESULT;
        fn SetDeviceFormat(&self, device: PCWSTR, endpoint: *mut c_void, mix: *mut c_void) -> HRESULT;
        fn GetProcessingPeriod(&self, device: PCWSTR, default: i32, period: *mut i64, min: *mut i64) -> HRESULT;
        fn SetProcessingPeriod(&self, device: PCWSTR, period: *mut i64) -> HRESULT;
        fn GetShareMode(&self, device: PCWSTR, mode: *mut c_void) -> HRESULT;
        fn SetShareMode(&self, device: PCWSTR, mode: *mut c_void) -> HRESULT;
        fn GetPropertyValue(&self, device: PCWSTR, fx: i32, key: *const c_void, value: *mut c_void) -> HRESULT;
        fn SetPropertyValue(&self, device: PCWSTR, fx: i32, key: *const c_void, value: *mut c_void) -> HRESULT;
        fn SetDefaultEndpoint(&self, device: PCWSTR, role: ERole) -> HRESULT;
        fn SetEndpointVisibility(&self, device: PCWSTR, visible: i32) -> HRESULT;
    }

    static STATE: OnceLock<Mutex<AudioState>> = OnceLock::new();
    static REFRESH: OnceLock<Sender<()>> = OnceLock::new();

    fn state() -> &'static Mutex<AudioState> {
        STATE.get_or_init(|| {
            Mutex::new(AudioState {
                available: true,
                devices: Vec::new(),
            })
        })
    }

    pub fn snapshot() -> AudioState {
        state().lock().map(|s| s.clone()).unwrap_or_default()
    }

    /// Makes `id` the default for music, games and calls alike, the way the
    /// taskbar's output picker does.
    pub fn set_default(id: &str) -> Result<(), String> {
        unsafe {
            // Fails harmlessly when the thread already has COM set up.
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let policy: IPolicyConfig =
                CoCreateInstance(&POLICY_CONFIG_CLSID, None, CLSCTX_ALL).map_err(|e| e.message())?;
            let wide = HSTRING::from(id);
            for role in [eConsole, eMultimedia, eCommunications] {
                policy
                    .SetDefaultEndpoint(PCWSTR(wide.as_ptr()), role)
                    .ok()
                    .map_err(|e| e.message())?;
            }
        }
        if let Some(tx) = REFRESH.get() {
            let _ = tx.send(());
        }
        Ok(())
    }

    pub fn init(app: &AppHandle) {
        let app = app.clone();
        std::thread::Builder::new()
            .name("audio".into())
            .spawn(move || {
                if let Err(e) = run(app) {
                    eprintln!("audio: {e}");
                }
            })
            .ok();
    }

    fn run(app: AppHandle) -> windows::core::Result<()> {
        let (tx, rx) = channel::<()>();
        let _ = REFRESH.set(tx.clone());

        let default_tx = tx.clone();
        MediaDevice::DefaultAudioRenderDeviceChanged(&TypedEventHandler::new(move |_, _| {
            let _ = default_tx.send(());
            Ok(())
        }))?;

        // Kept alive for as long as the worker runs.
        let watcher = DeviceInformation::CreateWatcherAqsFilter(&MediaDevice::GetAudioRenderSelector()?)?;
        watch(&watcher, &tx)?;
        watcher.Start()?;

        let _ = tx.send(());
        loop {
            match rx.recv_timeout(BATTERY_REFRESH) {
                Ok(()) => {
                    std::thread::sleep(SETTLE);
                    while rx.try_recv().is_ok() {}
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            let devices = read_devices().unwrap_or_default();
            let next = AudioState {
                available: true,
                devices,
            };
            let changed = {
                let mut s = state().lock().expect("audio state poisoned");
                let changed = *s != next;
                *s = next.clone();
                changed
            };
            if changed {
                let _ = app.emit(DEVICES_EVENT, next);
            }
        }
        Ok(())
    }

    fn watch(watcher: &DeviceWatcher, tx: &Sender<()>) -> windows::core::Result<()> {
        let added = tx.clone();
        watcher.Added(&TypedEventHandler::new(move |_, _| {
            let _ = added.send(());
            Ok(())
        }))?;
        let updated = tx.clone();
        watcher.Updated(&TypedEventHandler::new(move |_, _| {
            let _ = updated.send(());
            Ok(())
        }))?;
        let removed = tx.clone();
        watcher.Removed(&TypedEventHandler::new(move |_, _| {
            let _ = removed.send(());
            Ok(())
        }))?;
        Ok(())
    }

    fn props(keys: &[&str]) -> IIterable<HSTRING> {
        IIterable::from(keys.iter().map(|k| HSTRING::from(*k)).collect::<Vec<_>>())
    }

    fn lookup<T: windows::core::RuntimeType + 'static>(info: &DeviceInformation, key: &str) -> Option<T> {
        let value: IInspectable = info.Properties().ok()?.Lookup(&HSTRING::from(key)).ok()?;
        value.cast::<IReference<T>>().ok()?.Value().ok()
    }

    /// `\\?\SWD#MMDEVAPI#{0.0.0.00000000}.{…}#{…}` → `{0.0.0.00000000}.{…}`,
    /// the endpoint id Core Audio (and IPolicyConfig) understands.
    fn endpoint_id(winrt_id: &str) -> Option<String> {
        let rest = &winrt_id[winrt_id.to_ascii_uppercase().find("MMDEVAPI#")? + "MMDEVAPI#".len()..];
        Some(rest.split('#').next()?.to_string())
    }

    fn kind(form_factor: Option<u32>) -> &'static str {
        // EndpointFormFactor: 1 Speakers, 3 Headphones, 5 Headset.
        match form_factor {
            Some(1) => "speakers",
            Some(3) => "headphones",
            Some(5) => "headset",
            _ => "other",
        }
    }

    fn read_devices() -> windows::core::Result<Vec<AudioDevice>> {
        let default_id = MediaDevice::GetDefaultAudioRenderId(AudioDeviceRole::Default)
            .map(|s| s.to_string())
            .unwrap_or_default();
        let all = DeviceInformation::FindAllAsyncAqsFilterAndAdditionalProperties(
            &MediaDevice::GetAudioRenderSelector()?,
            &props(&[FORM_FACTOR, CONTAINER_ID]),
        )?
        .join()?;

        let mut devices = Vec::new();
        for info in all {
            if !info.IsEnabled().unwrap_or(true) {
                continue;
            }
            let winrt_id = info.Id()?.to_string();
            let Some(id) = endpoint_id(&winrt_id) else {
                continue;
            };
            let (bluetooth, battery) = lookup::<GUID>(&info, CONTAINER_ID)
                .filter(|c| *c != COMPUTER_CONTAINER)
                .map(read_bluetooth)
                .unwrap_or((false, None));
            devices.push(AudioDevice {
                id,
                name: info.Name()?.to_string(),
                kind: kind(lookup::<u32>(&info, FORM_FACTOR)).into(),
                is_default: winrt_id.eq_ignore_ascii_case(&default_id),
                bluetooth,
                battery,
            });
        }
        devices.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(devices)
    }

    /// Whether the physical device behind an endpoint is Bluetooth, and its
    /// battery if one of its parts (usually the hands-free one) reports it.
    fn read_bluetooth(container: GUID) -> (bool, Option<u8>) {
        let filter = HSTRING::from(format!("System.Devices.ContainerId:=\"{{{container:?}}}\""));
        let Ok(parts) = DeviceInformation::FindAllAsyncWithKindAqsFilterAndAdditionalProperties(
            &filter,
            &props(&[BATTERY]),
            DeviceInformationKind::Device,
        )
        .and_then(|op| op.join()) else {
            return (false, None);
        };

        let mut bluetooth = false;
        let mut battery = None;
        for part in parts {
            let id = part.Id().map(|s| s.to_string().to_ascii_uppercase()).unwrap_or_default();
            bluetooth |= id.starts_with("BTH");
            battery = battery.or(lookup::<u8>(&part, BATTERY).filter(|b| *b <= 100));
        }
        (bluetooth, battery)
    }
}
