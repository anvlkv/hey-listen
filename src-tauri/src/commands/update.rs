//! Self-update commands (M33.C) — the app-side half of `tauri-plugin-updater`.
//!
//! The plugin is registered for the GUI only (see `lib.rs`), and the frontend drives
//! **one** path through these commands: [`check_update`] keeps the offered [`Update`] in
//! [`PendingUpdate`], then [`install_update`] downloads and installs it, streaming
//! `Started` / `Progress` / `Finished` over a [`Channel`]. Nothing installs silently —
//! the user confirms in the About dialog, and the frontend relaunches with
//! `@tauri-apps/plugin-process` afterwards.
//!
//! See `docs/updater.md` and ADR-30.

use std::sync::Mutex;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Debug, thiserror::Error)]
pub enum UpdateError {
    #[error("could not check for updates: {0}")]
    Check(#[from] tauri_plugin_updater::Error),
    #[error("no update is ready to install — check for updates first")]
    NoPendingUpdate,
    #[error("the pending update state is unavailable")]
    Unavailable,
}

// `tauri` command errors must be `Serialize`; surface the human-readable message.
serialize_error_as_string!(UpdateError);

/// What the feed announced, as the dialog shows it.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UpdateMetadata {
    /// The version this build reports.
    pub current_version: String,
    /// The version the feed announces.
    pub version: String,
    /// Release notes from the feed, when it has any (markdown).
    pub notes: Option<String>,
}

/// Download progress, one message per [`Channel`] send. The shape matches the
/// updater plugin's own `DownloadEvent`, so the frontend handler reads the same
/// `{ event, data }` messages the plugin's JS API documents.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(tag = "event", content = "data")]
#[ts(export)]
pub enum DownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        content_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
    },
    Finished,
}

/// The update the user was offered, kept between [`check_update`] and
/// [`install_update`] (a second check replaces it).
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

/// Ask the feed for a newer build; `None` means this one is current.
#[tauri::command]
pub async fn check_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<Option<UpdateMetadata>, UpdateError> {
    let update = app.updater()?.check().await?;

    let metadata = update.as_ref().map(|update| UpdateMetadata {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        notes: update.body.clone(),
    });

    *pending.0.lock().map_err(|_| UpdateError::Unavailable)? = update;
    Ok(metadata)
}

/// Download and install the pending update, reporting progress on `on_event`.
///
/// The frontend confirms first; this only runs on an explicit click. A failed
/// download keeps the offer pending so the user can retry without a second check.
#[tauri::command]
pub async fn install_update(
    pending: State<'_, PendingUpdate>,
    on_event: Channel<DownloadEvent>,
) -> Result<(), UpdateError> {
    let update = {
        let mut slot = pending.0.lock().map_err(|_| UpdateError::Unavailable)?;
        slot.take().ok_or(UpdateError::NoPendingUpdate)?
    };

    let mut first_chunk = true;
    let result = update
        .download_and_install(
            |chunk_length, content_length| {
                if first_chunk {
                    first_chunk = false;
                    let _ = on_event.send(DownloadEvent::Started { content_length });
                }
                let _ = on_event.send(DownloadEvent::Progress { chunk_length });
            },
            || {
                let _ = on_event.send(DownloadEvent::Finished);
            },
        )
        .await;

    if result.is_err() {
        // Keep the offer so a retry needs no round trip; a poisoned lock only means a
        // previous send panicked, which costs the user one extra check.
        if let Ok(mut slot) = pending.0.lock() {
            *slot = Some(update);
        }
    }

    result?;
    Ok(())
}
