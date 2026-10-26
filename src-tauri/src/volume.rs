//! The system's master volume, changed with the mouse wheel over the bar.
//!
//! On Windows this is the default playback device's endpoint volume (Core
//! Audio), the same level the taskbar's volume slider shows.

use serde::Serialize;

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Volume {
    /// 0.0 – 1.0.
    pub level: f32,
    pub muted: bool,
}

#[cfg(windows)]
pub use windows_impl::step;

#[cfg(not(windows))]
pub fn step(_delta: f32) -> Result<Volume, String> {
    Err("Volume control is only available on Windows".into())
}

#[cfg(windows)]
mod windows_impl {
    use super::Volume;
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

    /// Moves the volume by `delta` (e.g. 0.02 for 2 %) and returns the new level.
    /// Turning it up also unmutes.
    pub fn step(delta: f32) -> Result<Volume, String> {
        unsafe {
            // Fails harmlessly when the thread already has COM set up.
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let endpoint = (|| -> windows::core::Result<IAudioEndpointVolume> {
                let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
                let device = devices.GetDefaultAudioEndpoint(eRender, eConsole)?;
                device.Activate(CLSCTX_ALL, None)
            })()
            .map_err(|e| e.message())?;

            let current = endpoint.GetMasterVolumeLevelScalar().map_err(|e| e.message())?;
            let level = (current + delta).clamp(0.0, 1.0);
            endpoint
                .SetMasterVolumeLevelScalar(level, std::ptr::null())
                .map_err(|e| e.message())?;
            if delta > 0.0 {
                let _ = endpoint.SetMute(false, std::ptr::null());
            }
            let muted = endpoint.GetMute().map(|m| m.as_bool()).unwrap_or(false);
            Ok(Volume { level, muted })
        }
    }
}
