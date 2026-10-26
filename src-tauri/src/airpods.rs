//! AirPods (and Beats) battery and in-ear status.
//!
//! Apple headphones keep broadcasting a small Bluetooth LE advertisement
//! ("proximity pairing", Apple's company id 0x004C, type 0x07) that iPhones
//! use for their battery pop-up. It carries each earbud's and the case's
//! battery in 10 % steps, what is charging, and which earbuds are in an ear.
//! It isn't encrypted, so Windows can read it with a passive scan, the same
//! way MagicPods and OpenPods do.
//!
//! The advertisement doesn't say whose AirPods sent it, so only strong
//! signals count and the strongest recent one wins. The frontend also only
//! shows it while AirPods are the playback device.

use serde::Serialize;

/// Event name the frontend listens to.
#[cfg_attr(not(windows), allow(dead_code))]
pub const UPDATE_EVENT: &str = "airpods://update";

#[derive(Clone, Copy, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Pod {
    /// Percent in 10 % steps; None while unknown (e.g. a bud in a closed case).
    pub battery: Option<u8>,
    pub charging: bool,
    pub in_ear: bool,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Pods {
    /// e.g. "AirPods Pro 2".
    pub model: String,
    pub left: Pod,
    pub right: Pod,
    pub case: Pod,
    /// False once nothing has been heard for a while (the case was closed or
    /// they went out of range); the values are then the last known ones.
    pub fresh: bool,
}

#[cfg_attr(not(windows), allow(dead_code))]
fn model_name(id: u16) -> &'static str {
    match id {
        0x2002 => "AirPods",
        0x200F => "AirPods 2",
        0x2013 => "AirPods 3",
        0x2019 => "AirPods 4",
        0x201B => "AirPods 4",
        0x200E => "AirPods Pro",
        0x2014 | 0x2024 => "AirPods Pro 2",
        0x2027 => "AirPods Pro 3",
        0x200A | 0x201F => "AirPods Max",
        0x200B => "Powerbeats Pro",
        0x2011 => "Beats Studio Buds",
        0x2012 => "Beats Fit Pro",
        _ => "AirPods",
    }
}

/// Reads one proximity pairing message (the manufacturer data after the
/// company id). Layout, as documented by OpenPods and AirPodsDesktop:
///
/// | byte | meaning |
/// |------|---------|
/// | 0    | type, 0x07 |
/// | 1    | length of the rest |
/// | 3–4  | model, little endian |
/// | 5    | status: 0x02 this bud in ear, 0x08 the other in ear, 0x20 this bud is the left one |
/// | 6    | battery: low nibble this bud, high nibble the other |
/// | 7    | low nibble case battery; 0x10 this bud, 0x20 the other, 0x40 case charging |
///
/// Battery nibbles are 0–10 (× 10 %); 15 means unknown.
#[cfg_attr(not(windows), allow(dead_code))]
fn parse(data: &[u8]) -> Option<Pods> {
    if data.len() < 9 || data[0] != 0x07 {
        return None;
    }
    let model = u16::from_le_bytes([data[3], data[4]]);
    // Every Apple/Beats headphone model so far is 0x20xx.
    if model >> 8 != 0x20 {
        return None;
    }
    let status = data[5];
    let battery = |nibble: u8| (nibble <= 10).then_some(nibble * 10);
    let pod = |level: u8, charging: bool, in_ear: bool| Pod {
        battery: battery(level),
        charging,
        // A charging bud sits in the case, whatever the ear bit says.
        in_ear: in_ear && !charging,
    };

    let this = pod(data[6] & 0x0F, data[7] & 0x10 != 0, status & 0x02 != 0);
    let other = pod(data[6] >> 4, data[7] & 0x20 != 0, status & 0x08 != 0);
    let (left, right) = if status & 0x20 != 0 { (this, other) } else { (other, this) };
    Some(Pods {
        model: model_name(model).into(),
        left,
        right,
        case: Pod {
            battery: battery(data[7] & 0x0F),
            charging: data[7] & 0x40 != 0,
            in_ear: false,
        },
        fresh: true,
    })
}

#[cfg(windows)]
pub use windows_impl::{init, snapshot};

#[cfg(not(windows))]
pub use fallback::{init, snapshot};

#[cfg(not(windows))]
mod fallback {
    use super::Pods;

    pub fn init(_app: &tauri::AppHandle) {}

    pub fn snapshot() -> Option<Pods> {
        None
    }
}

#[cfg(windows)]
mod windows_impl {
    use super::{parse, Pods, UPDATE_EVENT};
    use std::sync::{Mutex, OnceLock};
    use std::time::{Duration, Instant};
    use tauri::{AppHandle, Emitter};
    use windows::Devices::Bluetooth::Advertisement::{
        BluetoothLEAdvertisementReceivedEventArgs, BluetoothLEAdvertisementWatcher,
        BluetoothLEAdvertisementWatcherStatus as Status, BluetoothLEScanningMode,
    };
    use windows::Foundation::TypedEventHandler;
    use windows::Storage::Streams::DataReader;

    const APPLE: u16 = 0x004C;
    /// Weaker than this is most likely someone else's AirPods.
    const MIN_RSSI: i16 = -70;
    /// How long a sender stays a candidate after its last advertisement.
    const CANDIDATE_FOR: Duration = Duration::from_secs(10);
    /// Nothing heard for this long: the values go stale.
    const STALE_AFTER: Duration = Duration::from_secs(30);
    /// How often staleness is checked and a stopped scan is restarted
    /// (Bluetooth turned off and on again, the adapter waking from sleep…).
    const WATCHDOG: Duration = Duration::from_secs(10);

    struct Heard {
        address: u64,
        rssi: i16,
        at: Instant,
        pods: Pods,
    }

    #[derive(Default)]
    struct Shared {
        /// The sender currently shown.
        current: Option<Heard>,
        /// What the frontend last got.
        sent: Option<Pods>,
    }

    static SHARED: OnceLock<Mutex<Shared>> = OnceLock::new();

    fn shared() -> &'static Mutex<Shared> {
        SHARED.get_or_init(Default::default)
    }

    pub fn snapshot() -> Option<Pods> {
        shared().lock().ok()?.sent.clone()
    }

    pub fn init(app: &AppHandle) {
        let app = app.clone();
        std::thread::Builder::new()
            .name("airpods".into())
            .spawn(move || {
                if let Err(e) = run(app) {
                    eprintln!("airpods: {e}");
                }
            })
            .ok();
    }

    fn run(app: AppHandle) -> windows::core::Result<()> {
        let watcher = BluetoothLEAdvertisementWatcher::new()?;
        // Passive: listen only, never ask devices for more.
        watcher.SetScanningMode(BluetoothLEScanningMode::Passive)?;
        let received_app = app.clone();
        watcher.Received(&TypedEventHandler::new(
            move |_, args: windows::core::Ref<BluetoothLEAdvertisementReceivedEventArgs>| {
                if let Some(args) = args.as_ref() {
                    if let Some(heard) = read(args) {
                        consider(&received_app, heard);
                    }
                }
                Ok(())
            },
        ))?;

        loop {
            match watcher.Status() {
                Ok(Status::Started) | Ok(Status::Stopping) => {}
                // No Bluetooth adapter, or it is off: try again later.
                _ => {
                    let _ = watcher.Start();
                }
            }
            std::thread::sleep(WATCHDOG);
            expire(&app);
        }
    }

    fn read(args: &BluetoothLEAdvertisementReceivedEventArgs) -> Option<Heard> {
        let rssi = args.RawSignalStrengthInDBm().ok()?;
        if rssi < MIN_RSSI {
            return None;
        }
        for section in args.Advertisement().ok()?.ManufacturerData().ok()? {
            if section.CompanyId().ok()? != APPLE {
                continue;
            }
            let buffer = section.Data().ok()?;
            let mut bytes = vec![0u8; buffer.Length().ok()? as usize];
            DataReader::FromBuffer(&buffer).ok()?.ReadBytes(&mut bytes).ok()?;
            if let Some(pods) = parse(&bytes) {
                return Some(Heard {
                    address: args.BluetoothAddress().unwrap_or(0),
                    rssi,
                    at: Instant::now(),
                    pods,
                });
            }
        }
        None
    }

    /// Keeps following the same sender, unless it went quiet or a clearly
    /// stronger one (closer to this computer) shows up.
    fn consider(app: &AppHandle, heard: Heard) {
        let Ok(mut s) = shared().lock() else {
            return;
        };
        let take = match &s.current {
            None => true,
            Some(cur) => {
                cur.address == heard.address || cur.at.elapsed() > CANDIDATE_FOR || heard.rssi > cur.rssi + 10
            }
        };
        if take {
            s.current = Some(heard);
            publish(app, &mut s);
        }
    }

    fn expire(app: &AppHandle) {
        let Ok(mut s) = shared().lock() else {
            return;
        };
        if let Some(cur) = &mut s.current {
            if cur.pods.fresh && cur.at.elapsed() > STALE_AFTER {
                cur.pods.fresh = false;
                cur.pods.left.in_ear = false;
                cur.pods.right.in_ear = false;
                publish(app, &mut s);
            }
        }
    }

    fn publish(app: &AppHandle, s: &mut Shared) {
        let pods = s.current.as_ref().map(|c| c.pods.clone());
        if pods != s.sent {
            s.sent = pods.clone();
            let _ = app.emit(UPDATE_EVENT, pods);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_airpods_pro_2() {
        // Left bud broadcasting, in ear, 80 %; right 70 % and in ear; case 50 %
        // and charging.
        let data = [0x07, 0x19, 0x01, 0x14, 0x20, 0x2B, 0x78, 0x45, 0x00];
        let pods = parse(&data).unwrap();
        assert_eq!(pods.model, "AirPods Pro 2");
        assert_eq!(pods.left, Pod { battery: Some(80), charging: false, in_ear: true });
        assert_eq!(pods.right, Pod { battery: Some(70), charging: false, in_ear: true });
        assert_eq!(pods.case, Pod { battery: Some(50), charging: true, in_ear: false });
    }

    #[test]
    fn right_bud_broadcasting_and_unknown_levels() {
        // Right bud broadcasting and in ear at 100 %; left unknown; case unknown.
        let data = [0x07, 0x19, 0x01, 0x14, 0x20, 0x02, 0xFA, 0x0F, 0x00];
        let pods = parse(&data).unwrap();
        assert_eq!(pods.right, Pod { battery: Some(100), charging: false, in_ear: true });
        assert_eq!(pods.left, Pod { battery: None, charging: false, in_ear: false });
        assert_eq!(pods.case.battery, None);
    }

    #[test]
    fn ignores_other_apple_messages() {
        assert!(parse(&[0x10, 0x05, 0x01, 0x18, 0x00, 0x00, 0x00, 0x00, 0x00]).is_none());
        assert!(parse(&[0x07, 0x19]).is_none());
    }
}
