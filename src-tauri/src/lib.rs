// Hey Listen — audio analysis workbench.
//
// This is the Rust core: it owns audio capture/decode/analysis, the project-file
// store, and the IPC boundary exposed to the SolidJS frontend. See `docs/` for
// the architecture and the planned command/event surface.

mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![commands::ping])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
