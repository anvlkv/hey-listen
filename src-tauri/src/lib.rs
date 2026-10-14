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

mod app_activity;
mod audio;
mod cli;
mod commands;
mod mcp;
mod menu;
mod project;
mod recent;
mod state;
mod themes;

use std::io::Write as _;

use tauri::{Manager, WebviewWindowBuilder};

/// Run the stdio MCP entry (`heylisten-mcp`, or `hey-listen --mcp`).
///
/// Auto-detects: a running, MCP-enabled app serves the tools (**bridge**, with UI
/// following); otherwise the **core-native headless** server runs. `headless`
/// (`--headless`) forces the headless server. The standalone `heylisten-mcp` binary
/// is a plain console program (no GUI), so this works on a headless host too.
/// See [`mcp::run`].
pub fn run_mcp(headless: bool) -> std::io::Result<()> {
    mcp::run(headless)
}

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
        // CLI flags are declared in `tauri.conf.json` (`plugins.cli`); the app reads
        // the parsed matches in `setup` to route `--mcp` without opening a window.
        .plugin(tauri_plugin_cli::init())
        // MCP control persistence (`mcp-settings.json`) and the popover's Copy button.
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        // E2E testing (M8): the embedded WebDriver server + the execute/mocking
        // plugin. Inert unless a WebDriver session drives the app (the server only
        // binds when `TAURI_WEBDRIVER_PORT` is set). See `docs/testing.md`.
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init())
        .setup(|app| {
            log::info!("hey-listen {} starting", env!("CARGO_PKG_VERSION"));

            // Resolve the CLI entry before any window is built. `--mcp` runs the stdio
            // MCP session; a batch subcommand (`analyzers` / `analyze` / `synth`) runs
            // windowless and exits; neither means the GUI. See `docs/cli.md`.
            let entry = cli::parse(app.handle());
            match entry {
                cli::Entry::Mcp { headless } => {
                    // No dock icon for the CLI entry (macOS).
                    #[cfg(target_os = "macos")]
                    app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                    if let Err(err) = mcp::run(headless) {
                        eprintln!("hey-listen --mcp: {err}");
                        std::process::exit(1);
                    }
                    std::process::exit(0);
                }
                cli::Entry::Batch(request) => {
                    // The batch CLI is windowless too: print, flush, and exit before the
                    // GUI (or its webview) is ever created.
                    #[cfg(target_os = "macos")]
                    app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                    let stdout = std::io::stdout();
                    let mut out = std::io::BufWriter::new(stdout.lock());
                    let code = cli::batch::run(&request, &mut out);
                    let _ = out.flush();
                    std::process::exit(code);
                }
                cli::Entry::Usage(message) => {
                    // A genuine CLI usage error must not silently open the GUI.
                    eprintln!("{message}");
                    std::process::exit(2);
                }
                cli::Entry::Gui => {}
            }

            // Keep the process responsive while it is in the background: the MCP server
            // answers an agent in another window, and capture keeps running when the user
            // switches away — both would be throttled by macOS App Nap.
            // See `app_activity`.
            app_activity::prevent();

            // Per-window project state (one window = one project = one source,
            // ADR-3): the source PCM, filter graph, preview player, and capture
            // session are resolved per window label (see `state::WindowRegistry`).
            app.manage(state::WindowRegistry::default());
            // Recent project files (loaded from the app config dir) — backs the menu.
            app.manage(recent::RecentProjects::load(app.handle()));
            // File-open requests from the command line / OS (drained by the frontend).
            app.manage(commands::project::OpenedFiles::default());
            // MCP server (M9): in-flight tool calls forwarded to a window's frontend.
            app.manage(mcp::Pending::default());
            // MCP settings + server lifecycle: load the persisted config and, when it
            // is enabled, start the loopback endpoint the bridge connects to.
            app.manage(mcp::settings::McpController::load(app.handle()));

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
            commands::mcp::mcp_respond,
            commands::mcp::mcp_ready,
            commands::mcp::get_mcp_status,
            commands::mcp::set_mcp_config,
            commands::themes::theme_dir,
            commands::themes::list_themes,
            commands::themes::write_theme,
            commands::themes::delete_theme,
            commands::themes::import_theme_file,
            commands::themes::export_theme_file,
            commands::themes::pick_theme_import_path,
            commands::themes::pick_theme_export_path,
            commands::themes::reveal_theme_dir,
            commands::app::open_external_url,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(handle_run_event);
}

/// Handle app-level run events: drop the MCP advertisement on exit, and open a
/// `.heyl` project when the OS asks us to (macOS/`open`-with file association).
fn handle_run_event<R: tauri::Runtime>(app: &tauri::AppHandle<R>, event: tauri::RunEvent) {
    match event {
        // Stop the MCP server (and drop its advertisement) on exit.
        tauri::RunEvent::Exit => app.state::<mcp::settings::McpController>().stop(app),
        #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
        tauri::RunEvent::Opened { urls } => {
            let paths = commands::project::opened_paths_from_urls(urls);
            commands::project::handle_open_paths(app, paths);
        }
        _ => {}
    }
}
