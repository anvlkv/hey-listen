//! The capture poll thread: control messages, the chunk/event loop, and the
//! flexaudio event mapping.
//!
//! `flexaudio::Stream` is owned by this dedicated thread (see the module docs in
//! [`super`]); the command layer reaches it only through the small control channel
//! the handle in [`super`] holds.

use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::Duration;

use flexaudio::{Event as FlexEvent, Stream};

use super::{CaptureEvent, CaptureMessage};

/// How long the poll loop waits for the next chunk/control before re-checking.
const POLL_INTERVAL: Duration = Duration::from_millis(4);

/// Control messages for the poll thread.
pub(super) enum Control {
    Pause,
    Resume,
    SetGain(f32),
    Stop,
}

/// Poll loop: apply pending controls, drain chunks/events, and idle-wait otherwise.
pub(super) fn poll_loop(
    stream: &mut Stream,
    controls: &Receiver<Control>,
    mut sink: impl FnMut(CaptureMessage),
) {
    loop {
        let mut stop = false;
        while let Ok(message) = controls.try_recv() {
            if apply(stream, message, &mut sink) {
                stop = true;
            }
        }
        if stop {
            break;
        }

        let mut idle = true;
        while let Some(chunk) = stream.poll_chunk() {
            idle = false;
            sink(CaptureMessage::Chunk(chunk.data));
        }
        while let Some(event) = stream.poll_event() {
            idle = false;
            if let Some(event) = map_event(event) {
                sink(CaptureMessage::Event(event));
            }
        }

        if idle {
            // Wait for a control message (wakes immediately) or the poll interval.
            match controls.recv_timeout(POLL_INTERVAL) {
                Ok(message) => {
                    if apply(stream, message, &mut sink) {
                        break;
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                // The handle was dropped; stop the stream.
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
    }

    stream.stop();
}

/// Apply one control message; returns `true` if the loop should stop.
///
/// `pause` is infallible, but `resume` and `set_gain` report a failure by `Err` (0.5:
/// a successful `resume` can still return the stored permission error once capture has
/// terminally failed). The command layer cannot see that — it only hands this thread a
/// message — so a failed control is surfaced as a capture error event instead of being
/// dropped.
fn apply(stream: &Stream, message: Control, sink: &mut impl FnMut(CaptureMessage)) -> bool {
    match message {
        Control::Pause => {
            stream.pause();
            false
        }
        Control::Resume => {
            report_failure(stream.resume(), "resume", sink);
            false
        }
        Control::SetGain(gain) => {
            report_failure(stream.set_gain(gain), "set gain", sink);
            false
        }
        Control::Stop => true,
    }
}

/// Surface a failed control as a capture error event (see [`apply`]).
fn report_failure(
    result: Result<(), flexaudio::Error>,
    action: &str,
    sink: &mut impl FnMut(CaptureMessage),
) {
    if let Err(error) = result {
        sink(CaptureMessage::Event(CaptureEvent {
            kind: "error".to_string(),
            message: Some(format!("capture {action} failed: {error}")),
        }));
    }
}

/// Map a flexaudio event to the frontend-facing shape.
///
/// The event vocabulary is the pre-0.5 one (`dropped` | `stalled` | `recovered` |
/// `permission` | `device-lost` | `error`), so the frontend's `STATUS_TEXT` still
/// covers every kind. 0.5 split the old `Error(String)` failure signal into
/// `TerminalError` / `RecoverableError` and gave the permission events fields, so
/// those map onto the existing kinds: a denial carries the backend's own explanation
/// (it is a full sentence, far better than a generic label), a late grant clears the
/// banner the way `recovered` does, and errors carry their message either way.
///
/// The advisory variants (`PermissionPending`, `SilenceWhileSourceActive`, `Clipped`,
/// `AudioLoss`) are deliberately dropped: capture continues through them, and the
/// frontend has no surface that would not present them as failures.
fn map_event(event: FlexEvent) -> Option<CaptureEvent> {
    match event {
        FlexEvent::ChunkDropped { count } => Some(CaptureEvent {
            kind: "dropped".to_string(),
            message: Some(format!("{count} chunks dropped")),
        }),
        FlexEvent::StreamStalled => Some(CaptureEvent {
            kind: "stalled".to_string(),
            message: None,
        }),
        FlexEvent::StreamRecovered => Some(CaptureEvent {
            kind: "recovered".to_string(),
            message: None,
        }),
        FlexEvent::PermissionDenied { detail, .. } => Some(CaptureEvent {
            kind: "permission".to_string(),
            message: Some(detail),
        }),
        FlexEvent::PermissionGranted => Some(CaptureEvent {
            kind: "recovered".to_string(),
            message: None,
        }),
        FlexEvent::DeviceLost => Some(CaptureEvent {
            kind: "device-lost".to_string(),
            message: None,
        }),
        FlexEvent::Error(message) => Some(CaptureEvent {
            kind: "error".to_string(),
            message: Some(message),
        }),
        FlexEvent::TerminalError { error } | FlexEvent::RecoverableError { error } => {
            Some(CaptureEvent {
                kind: "error".to_string(),
                message: Some(error.to_string()),
            })
        }
        _ => None,
    }
}
