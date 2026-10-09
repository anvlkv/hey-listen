// Hey Listen — audio analysis workbench.
//
// This is the Rust core: it owns audio capture/decode/analysis, the project-file
// store, and the IPC boundary exposed to the SolidJS frontend. See `docs/` for
// the architecture and the planned command/event surface.

mod audio;
mod commands;
mod menu;
mod project;
mod recent;
mod state;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // One capture session per window (one window = one project = one source).
            app.manage(commands::capture::CaptureState::default());
            // Core-owned source PCM, filter graph, and preview player (ADR-9).
            app.manage(state::AudioState::new());
            // Recent project files (loaded from the app config dir) — backs the menu.
            app.manage(recent::RecentProjects::load(app.handle()));
            // File-open requests from the command line / OS (drained by the frontend).
            app.manage(commands::project::OpenedFiles::default());

            // Native menu; File actions go to the frontend, the rest are native.
            let menu = menu::build(app.handle())?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| menu::on_menu_event(app, &event));

            // A `.heyl` path passed on the command line (Windows/Linux association).
            let from_args = commands::project::opened_paths_from_args(std::env::args());
            commands::project::handle_open_paths(app.handle(), from_args);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::source::pick_audio_file,
            commands::source::clear_audio_source,
            commands::source::begin_capture_source,
            commands::source::end_capture_source,
            commands::decode::probe_file,
            commands::decode::stream_file,
            commands::capture::list_devices,
            commands::capture::list_processes,
            commands::capture::start_capture,
            commands::capture::stop_capture,
            commands::capture::pause_capture,
            commands::capture::resume_capture,
            commands::capture::set_capture_gain,
            commands::graph::set_filter_graph,
            commands::graph::render_synth,
            commands::playback::list_output_devices,
            commands::playback::preview_region,
            commands::playback::stop_preview,
            commands::playback::set_output_gain,
            commands::playback::preview_position,
            commands::analysis::run_analysis,
            commands::project::save_project,
            commands::project::load_project,
            commands::project::pick_project_open_path,
            commands::project::pick_project_save_path,
            commands::project::take_pending_open_paths,
            commands::project::add_recent_project,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(handle_run_event);
}

/// Handle a macOS/`open`-with request (file association) for a running app.
#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
fn handle_run_event<R: tauri::Runtime>(app: &tauri::AppHandle<R>, event: tauri::RunEvent) {
    if let tauri::RunEvent::Opened { urls } = event {
        let paths = commands::project::opened_paths_from_urls(urls);
        commands::project::handle_open_paths(app, paths);
    }
}

/// No-op on platforms without an `open`-with run event (files arrive via argv).
#[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]
fn handle_run_event<R: tauri::Runtime>(_app: &tauri::AppHandle<R>, _event: tauri::RunEvent) {}
