// Hey Listen — audio analysis workbench.
//
// This is the Rust core: it owns audio capture/decode/analysis, the project-file
// store, and the IPC boundary exposed to the SolidJS frontend. See `docs/` for
// the architecture and the planned command/event surface.

/// Implement `serde::Serialize` for a core error enum by serializing its `Display`
/// text — the shape `tauri` commands require. Every command error enum uses this so
/// the IPC error format (a plain message string) stays identical across modules.
#[macro_export]
macro_rules! serialize_error_as_string {
    ($t:ty) => {
        impl ::serde::Serialize for $t {
            fn serialize<S: ::serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                serializer.serialize_str(&self.to_string())
            }
        }
    };
}

mod audio;
mod commands;
mod menu;
mod project;
mod recent;
mod state;

use tauri::{Manager, WebviewWindowBuilder};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // File + stdout logging. A fresh file is started on every launch and the
        // file is rotated once it exceeds `max_file_size`, keeping the last few.
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("hey-listen".to_string()),
                    }),
                ])
                .file_open_strategy(tauri_plugin_log::FileOpenStrategy::Rotate)
                .max_file_size(2_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(3))
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            log::info!("hey-listen {} starting", env!("CARGO_PKG_VERSION"));
            // Per-window project state (one window = one project = one source,
            // ADR-3): the source PCM, filter graph, preview player, and capture
            // session are resolved per window label (see `state::WindowRegistry`).
            app.manage(state::WindowRegistry::default());
            // Recent project files (loaded from the app config dir) — backs the menu.
            app.manage(recent::RecentProjects::load(app.handle()));
            // File-open requests from the command line / OS (drained by the frontend).
            app.manage(commands::project::OpenedFiles::default());

            // Native menu; File actions go to the focused window, the rest are native.
            let menu = menu::build(app.handle())?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| menu::on_menu_event(app, &event));

            // The main window is built here (not from config) so it can be sized
            // and titled from Rust before the frontend loads.
            if let Some(config) = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .cloned()
            {
                WebviewWindowBuilder::from_config(app.handle(), &config)?.build()?;
            }

            // A `.heyl` path passed on the command line (Windows/Linux association).
            let from_args = commands::project::opened_paths_from_args(std::env::args());
            commands::project::handle_open_paths(app.handle(), from_args);
            Ok(())
        })
        // Drop a window's project state when it closes (frees its PCM and shuts its
        // preview player down), and close any popouts it owns (a popout is a view of
        // the project, not a project of its own).
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let app = window.app_handle();
                let registry = app.state::<state::WindowRegistry>();
                for popout in registry.popouts_of(window.label()) {
                    if let Some(popout) = app.get_webview_window(&popout) {
                        let _ = popout.destroy();
                    }
                }
                registry.remove(window.label());
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::source::pick_audio_file,
            commands::source::confirm,
            commands::source::close_window,
            commands::source::clear_audio_source,
            commands::source::begin_capture_source,
            commands::source::end_capture_source,
            commands::source::load_shared_source,
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
            commands::graph::render_filtered,
            commands::playback::list_output_devices,
            commands::playback::preview_region,
            commands::playback::stop_preview,
            commands::playback::set_output_gain,
            commands::playback::preview_position,
            commands::playback::output_level,
            commands::analysis::run_analysis,
            commands::ui::get_ui_state,
            commands::ui::set_ui_state,
            commands::project::save_project,
            commands::project::load_project,
            commands::project::pick_project_open_path,
            commands::project::pick_project_save_path,
            commands::project::take_pending_open_paths,
            commands::project::add_recent_project,
            commands::window::open_project_window,
            commands::window::open_popout_window,
            commands::window::popout_tool,
            commands::window::popout_tools,
            commands::window::focus_popout,
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
