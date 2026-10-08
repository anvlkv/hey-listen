// Hey Listen — audio analysis workbench.
//
// This is the Rust core: it owns audio capture/decode/analysis, the project-file
// store, and the IPC boundary exposed to the SolidJS frontend. See `docs/` for
// the architecture and the planned command/event surface.

mod audio;
mod commands;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // One capture session per window (one window = one project = one source).
            app.manage(commands::capture::CaptureState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::source::pick_audio_file,
            commands::decode::probe_file,
            commands::decode::stream_file,
            commands::capture::list_devices,
            commands::capture::list_processes,
            commands::capture::start_capture,
            commands::capture::stop_capture,
            commands::capture::pause_capture,
            commands::capture::resume_capture,
            commands::capture::set_capture_gain,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
