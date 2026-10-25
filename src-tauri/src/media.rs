//! "Now playing" information and media controls.
//!
//! On Windows this talks to the Global System Media Transport Controls
//! (GSMTC), the same source the volume flyout uses, so it works with Spotify,
//! browsers, Apple Music and anything else that reports to Windows.
//! Changes arrive as events and are pushed to the frontend as `media://update`;
//! nothing is polled, so the worker sleeps while nothing changes.

use serde::Serialize;

/// Event name the frontend listens to.
#[cfg_attr(not(windows), allow(dead_code))]
pub const UPDATE_EVENT: &str = "media://update";

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaState {
    /// False on platforms without media support.
    pub available: bool,
    /// True when some app is reporting a media session.
    pub has_session: bool,
    pub title: String,
    pub artist: String,
    /// App id of the player, e.g. `Spotify.exe`.
    pub source: String,
    pub playing: bool,
    /// Cover art as a `data:` URL, when the player provides one.
    pub thumbnail: Option<String>,
}

#[cfg(windows)]
pub use windows_impl::{control, init, snapshot};

#[cfg(not(windows))]
pub use fallback::{control, init, snapshot};

#[cfg(not(windows))]
mod fallback {
    use super::MediaState;

    pub fn init(_app: &tauri::AppHandle) {}

    pub fn snapshot() -> MediaState {
        MediaState::default()
    }

    pub fn control(_action: &str) -> Result<(), String> {
        Err("Media control is only available on Windows".into())
    }
}

#[cfg(windows)]
mod windows_impl {
    use super::{MediaState, UPDATE_EVENT};
    use base64::Engine;
    use std::sync::mpsc::{channel, Sender};
    use std::sync::{Mutex, OnceLock};
    use tauri::{AppHandle, Emitter};
    use windows::Foundation::TypedEventHandler;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Storage::Streams::{DataReader, IRandomAccessStreamReference};

    /// Covers larger than this are skipped rather than sent over IPC.
    const MAX_THUMBNAIL_BYTES: u64 = 2 * 1024 * 1024;

    enum Msg {
        /// The current session may have changed: re-subscribe.
        Rebind,
        /// Title, artist or playback state changed: re-read and emit.
        Refresh,
    }

    struct Shared {
        session: Option<Session>,
        state: MediaState,
    }

    static SHARED: OnceLock<Mutex<Shared>> = OnceLock::new();

    fn shared() -> &'static Mutex<Shared> {
        SHARED.get_or_init(|| {
            Mutex::new(Shared {
                session: None,
                state: MediaState {
                    available: true,
                    ..MediaState::default()
                },
            })
        })
    }

    pub fn snapshot() -> MediaState {
        shared().lock().map(|s| s.state.clone()).unwrap_or_default()
    }

    pub fn control(action: &str) -> Result<(), String> {
        let session = shared()
            .lock()
            .map_err(|e| e.to_string())?
            .session
            .clone()
            .ok_or("Nothing is playing")?;

        let op = match action {
            "toggle" => session.TryTogglePlayPauseAsync(),
            "play" => session.TryPlayAsync(),
            "pause" => session.TryPauseAsync(),
            "next" => session.TrySkipNextAsync(),
            "previous" => session.TrySkipPreviousAsync(),
            other => return Err(format!("Unknown media action: {other}")),
        };
        op.and_then(|op| op.join()).map_err(|e| e.message())?;
        Ok(())
    }

    pub fn init(app: &AppHandle) {
        let app = app.clone();
        std::thread::Builder::new()
            .name("media".into())
            .spawn(move || {
                if let Err(e) = run(app) {
                    eprintln!("media: {e}");
                }
            })
            .ok();
    }

    /// Worker loop: blocks on the channel, so it costs nothing while idle.
    fn run(app: AppHandle) -> windows::core::Result<()> {
        let manager = Manager::RequestAsync()?.join()?;
        let (tx, rx) = channel::<Msg>();

        let rebind_tx = tx.clone();
        manager.CurrentSessionChanged(&TypedEventHandler::new(move |_, _| {
            let _ = rebind_tx.send(Msg::Rebind);
            Ok(())
        }))?;

        // Subscription tokens of the session we are currently listening to.
        let mut bound: Option<(Session, i64, i64)> = None;
        // Cover art cache, keyed by "title\0artist".
        let mut cover: (String, Option<String>) = (String::new(), None);

        let _ = tx.send(Msg::Rebind);
        while let Ok(first) = rx.recv() {
            // Coalesce bursts: players often fire several events at once.
            let mut rebind = matches!(first, Msg::Rebind);
            while let Ok(more) = rx.try_recv() {
                rebind |= matches!(more, Msg::Rebind);
            }

            if rebind {
                if let Some((old, a, b)) = bound.take() {
                    let _ = old.RemoveMediaPropertiesChanged(a);
                    let _ = old.RemovePlaybackInfoChanged(b);
                }
                if let Ok(session) = manager.GetCurrentSession() {
                    bound = subscribe(&session, &tx).ok().map(|(a, b)| (session, a, b));
                }
            }

            let session = bound.as_ref().map(|(s, _, _)| s.clone());
            let state = read_state(session.as_ref(), &mut cover);

            let changed = {
                let mut s = shared().lock().expect("media state poisoned");
                s.session = session;
                let changed = s.state != state;
                s.state = state.clone();
                changed
            };
            if changed {
                let _ = app.emit(UPDATE_EVENT, state);
            }
        }
        Ok(())
    }

    fn subscribe(session: &Session, tx: &Sender<Msg>) -> windows::core::Result<(i64, i64)> {
        let props_tx = tx.clone();
        let a = session.MediaPropertiesChanged(&TypedEventHandler::new(move |_, _| {
            let _ = props_tx.send(Msg::Refresh);
            Ok(())
        }))?;
        let info_tx = tx.clone();
        let b = session.PlaybackInfoChanged(&TypedEventHandler::new(move |_, _| {
            let _ = info_tx.send(Msg::Refresh);
            Ok(())
        }))?;
        Ok((a, b))
    }

    fn read_state(session: Option<&Session>, cover: &mut (String, Option<String>)) -> MediaState {
        let mut state = MediaState {
            available: true,
            ..MediaState::default()
        };
        let Some(session) = session else {
            return state;
        };

        state.has_session = true;
        state.source = session
            .SourceAppUserModelId()
            .map(|s| s.to_string())
            .unwrap_or_default();
        state.playing = session
            .GetPlaybackInfo()
            .and_then(|info| info.PlaybackStatus())
            .map(|status| status == Status::Playing)
            .unwrap_or(false);

        if let Ok(props) = session.TryGetMediaPropertiesAsync().and_then(|op| op.join()) {
            state.title = props.Title().map(|s| s.to_string()).unwrap_or_default();
            state.artist = props.Artist().map(|s| s.to_string()).unwrap_or_default();

            let key = format!("{}\0{}", state.title, state.artist);
            if cover.0 != key {
                *cover = (key, props.Thumbnail().ok().and_then(|t| read_thumbnail(&t)));
            }
            state.thumbnail = cover.1.clone();
        }
        state
    }

    fn read_thumbnail(reference: &IRandomAccessStreamReference) -> Option<String> {
        let stream = reference.OpenReadAsync().ok()?.join().ok()?;
        let size = stream.Size().ok()?;
        if size == 0 || size > MAX_THUMBNAIL_BYTES {
            return None;
        }
        let mime = stream
            .ContentType()
            .map(|s| s.to_string())
            .ok()
            .filter(|s| s.starts_with("image/"))
            .unwrap_or_else(|| "image/png".into());

        let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0).ok()?).ok()?;
        let loaded = reader.LoadAsync(size as u32).ok()?.join().ok()?;
        let mut bytes = vec![0u8; loaded as usize];
        reader.ReadBytes(&mut bytes).ok()?;

        let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
        Some(format!("data:{mime};base64,{b64}"))
    }
}
