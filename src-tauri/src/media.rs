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

/// Sent when only the playback position moved, so the cover art doesn't go
/// over IPC again every time the player reports its position.
#[cfg_attr(not(windows), allow(dead_code))]
pub const TIMELINE_EVENT: &str = "media://timeline";

#[derive(Clone, Copy, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Timeline {
    /// Where playback is, as of the moment this was read. 0 when unknown.
    pub position_ms: u64,
    /// Track length; 0 when the player doesn't report one.
    pub duration_ms: u64,
}

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
    pub timeline: Timeline,
}

#[cfg(windows)]
pub use windows_impl::{control, init, seek, snapshot};

#[cfg(not(windows))]
pub use fallback::{control, init, seek, snapshot};

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

    pub fn seek(_position_ms: u64) -> Result<(), String> {
        Err("Media control is only available on Windows".into())
    }
}

#[cfg(windows)]
mod windows_impl {
    use super::{MediaState, Timeline, TIMELINE_EVENT, UPDATE_EVENT};
    use std::time::{SystemTime, UNIX_EPOCH};
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

    fn current_session() -> Result<Session, String> {
        shared()
            .lock()
            .map_err(|e| e.to_string())?
            .session
            .clone()
            .ok_or_else(|| "Nothing is playing".into())
    }

    /// Jumps to `position_ms` in the current track.
    pub fn seek(position_ms: u64) -> Result<(), String> {
        let ticks = (position_ms * 10_000) as i64;
        current_session()?
            .TryChangePlaybackPositionAsync(ticks)
            .and_then(|op| op.join())
            .map_err(|e| e.message())?;
        Ok(())
    }

    pub fn control(action: &str) -> Result<(), String> {
        let session = current_session()?;

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
        let mut bound: Option<(Session, [i64; 3])> = None;
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
                if let Some((old, [a, b, c])) = bound.take() {
                    let _ = old.RemoveMediaPropertiesChanged(a);
                    let _ = old.RemovePlaybackInfoChanged(b);
                    let _ = old.RemoveTimelinePropertiesChanged(c);
                }
                if let Ok(session) = manager.GetCurrentSession() {
                    bound = subscribe(&session, &tx).ok().map(|tokens| (session, tokens));
                }
            }

            let session = bound.as_ref().map(|(s, _)| s.clone());
            let state = read_state(session.as_ref(), &mut cover);

            // Everything but the position: a change there resends it all.
            let without_timeline = |s: &MediaState| MediaState {
                timeline: Timeline::default(),
                ..s.clone()
            };
            let (changed, moved) = {
                let mut s = shared().lock().expect("media state poisoned");
                s.session = session;
                let changed = without_timeline(&s.state) != without_timeline(&state);
                let moved = s.state.timeline != state.timeline;
                s.state = state.clone();
                (changed, moved)
            };
            if changed {
                let _ = app.emit(UPDATE_EVENT, state);
            } else if moved {
                let _ = app.emit(TIMELINE_EVENT, state.timeline);
            }
        }
        Ok(())
    }

    fn subscribe(session: &Session, tx: &Sender<Msg>) -> windows::core::Result<[i64; 3]> {
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
        let timeline_tx = tx.clone();
        let c = session.TimelinePropertiesChanged(&TypedEventHandler::new(move |_, _| {
            let _ = timeline_tx.send(Msg::Refresh);
            Ok(())
        }))?;
        Ok([a, b, c])
    }

    /// Now, in WinRT `DateTime` ticks (100 ns since 1601).
    fn now_ticks() -> i64 {
        const UNIX_EPOCH_TICKS: i64 = 116_444_736_000_000_000;
        let since_unix = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
        UNIX_EPOCH_TICKS + (since_unix.as_nanos() / 100) as i64
    }

    /// Position and length. Players report the position as of their last
    /// update, so while playing the time since then is added on.
    fn read_timeline(session: &Session, playing: bool) -> Timeline {
        let Ok(t) = session.GetTimelineProperties() else {
            return Timeline::default();
        };
        let ticks = |r: windows::core::Result<windows::Foundation::TimeSpan>| r.map(|d| d.Duration).unwrap_or(0);
        let start = ticks(t.StartTime());
        let end = ticks(t.EndTime());
        let mut position = ticks(t.Position()) - start;
        if playing {
            if let Ok(updated) = t.LastUpdatedTime() {
                if updated.UniversalTime > 0 {
                    position += (now_ticks() - updated.UniversalTime).max(0);
                }
            }
        }
        let duration = (end - start).max(0);
        if duration > 0 {
            position = position.min(duration);
        }
        Timeline {
            position_ms: (position.max(0) / 10_000) as u64,
            duration_ms: (duration / 10_000) as u64,
        }
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
        state.timeline = read_timeline(session, state.playing);

        if let Ok(props) = session.TryGetMediaPropertiesAsync().and_then(|op| op.join()) {
            state.title = props.Title().map(|s| s.to_string()).unwrap_or_default();
            state.artist = props.Artist().map(|s| s.to_string()).unwrap_or_default();

            let key = format!("{}\0{}", state.title, state.artist);
            // Players often send the cover a moment after the title, so a
            // missing one is looked up again on the next change.
            if cover.0 != key || cover.1.is_none() {
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
