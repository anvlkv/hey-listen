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
mod export;
mod mcp;
mod menu;
mod project;
mod recent;
mod state;
#[cfg(test)]
mod test_support;
mod themes;

use tauri::{Manager, WebviewWindowBuilder};
use tauri_plugin_prevent_default::Flags;

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

/// The `hey-listen-cli` console entry: parse `argv` with `clap`, run the batch command,
/// and write JSONL to `out`.
///
/// A plain console program — no Tauri app, no window, no log plugin (ADR-29) — so it
/// boots a bare host, writes stdout on Windows, and never aborts over a log path.
/// `src/bin/hey-listen-cli.rs` drives it.
pub fn run_batch_cli<I, T>(argv: I, out: &mut impl std::io::Write) -> i32
where
    I: IntoIterator<Item = T>,
    T: Into<std::ffi::OsString> + Clone,
{
    cli::console(argv, out)
}

/// Fold the batch CLI's final stdout flush into its exit code.
pub fn finish_batch_cli(code: i32, flushed: std::io::Result<()>) -> i32 {
    cli::finish(code, flushed)
}

/// The log plugin's targets for this entry.
///
/// The GUI keeps its rotated log file. The **CLI** entries (`--mcp`, `--headless`) log
/// to **stderr only**: a sandboxed or concurrent headless/CI run must not abort because
/// the log directory is unwritable or another instance holds the file, and it must never
/// write into the MCP entry's stdout (hey-listen-report §2.3). The batch CLI is a
/// separate console binary with no log plugin at all (ADR-29).
fn log_targets(cli_invocation: bool) -> Vec<tauri_plugin_log::Target> {
    use tauri_plugin_log::{Target, TargetKind};
    let stderr = Target::new(TargetKind::Stderr);
    if cli_invocation {
        return vec![stderr];
    }
    vec![
        stderr,
        Target::new(TargetKind::LogDir {
            file_name: Some("hey-listen".to_string()),
        }),
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // A CLI invocation (`--mcp`, `--headless`) must not register the WebDriver server:
    // it binds a fixed port and prints a preamble, which would contaminate the MCP
    // entry's stdout and slow every headless call. Resolve it from argv before the
    // builder is assembled (the plugin's own parse runs later, in `setup`).
    let cli_invocation = cli::is_cli_invocation();

    let prevent = tauri_plugin_prevent_default::Builder::new()
        .with_flags(Flags::debug())
        .build();

    let mut builder = tauri::Builder::default()
        // File + **stderr** logging for the GUI. The batch CLI writes JSONL to stdout, so
        // logs must never share that stream (the file target keeps the GUI's history).
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .targets(log_targets(cli_invocation))
                .file_open_strategy(tauri_plugin_log::FileOpenStrategy::Rotate)
                .max_file_size(2_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(3))
                .build(),
        )
        .plugin(prevent)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // CLI flags are declared in `tauri.conf.json` (`plugins.cli`); the app reads
        // the parsed matches in `setup` to route `--mcp` without opening a window.
        .plugin(tauri_plugin_cli::init())
        // MCP control persistence (`mcp-settings.json`) and the popover's Copy button.
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        // `relaunch()` after an update installs (M33.C). The permission it needs is
        // `process:allow-restart` in `capabilities/default.json`.
        .plugin(tauri_plugin_process::init());

    // Self-update (M33.C, ADR-30). GUI only: a CLI invocation (`--mcp`) has no window and
    // must not register update commands or reach the network. `tauri-plugin-updater` is a
    // desktop-only dependency. See `docs/updater.md`.
    #[cfg(desktop)]
    if !cli_invocation {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    // E2E testing (M8): the embedded WebDriver server + the execute/mocking plugin.
    // Registered only when the E2E service launched the app — `@wdio/tauri-service`
    // (embedded provider) sets `TAURI_WEBDRIVER_PORT` on the process it spawns. A
    // normal launch must not bind port 4445 or log `[WDIO]` chatter. GUI only — a
    // CLI process must stay a plain stdout/stderr program. See `docs/testing.md`.
    let e2e = std::env::var(tauri_plugin_wdio_webdriver::PORT_ENV_VAR).is_ok();
    if !cli_invocation && e2e {
        builder = builder
            .plugin(tauri_plugin_wdio::init())
            .plugin(tauri_plugin_wdio_webdriver::init());
    }

    builder
        .setup(|app| {
            log::info!("hey-listen {} starting", env!("CARGO_PKG_VERSION"));

            // Resolve the CLI entry before any window is built. `--mcp` runs the stdio
            // MCP session; neither flag means the GUI. The batch subcommands live in
            // the `hey-listen-cli` console binary (ADR-29). See `docs/cli.md`.
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
            // macOS can deliver the open-documents Apple Event before `setup` runs, so
            // adopt anything that was queued before this state existed.
            let opened_files = commands::project::OpenedFiles::default();
            opened_files.adopt_early();
            app.manage(opened_files);
            // The project a newly created window should open (the compare view's
            // "Open reference" / MCP `open_project_window`, M25.D); drained by that
            // window's frontend.
            app.manage(commands::window::project::PendingWindowPaths::default());
            // MCP server (M9): in-flight tool calls forwarded to a window's frontend.
            app.manage(mcp::Pending::default());
            // MCP settings + server lifecycle: load the persisted config and, when it
            // is enabled, start the loopback endpoint the bridge connects to.
            app.manage(mcp::settings::McpController::load(app.handle()));
            // The update the user was offered (M33.C), between check and install.
            #[cfg(desktop)]
            app.manage(commands::update::PendingUpdate::default());

            // CLI follows the app (ADR-30): when an installed `hey-listen-cli` came from
            // another app version, refresh it from this build. Off the UI thread, so a
            // relaunch after an update never waits on a file copy.
            commands::cli_install::refresh_on_startup(app.handle());

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
            commands::analysis::analyzer_detail,
            commands::analysis::analyzer_catalog,
            commands::analysis::run_analysis,
            commands::compare::run_comparison,
            commands::compare::peer::compare_peer_setup,
            commands::compare::peer::compare_live,
            commands::compare::peer::compare_targets,
            commands::compare::compare_saved,
            commands::compare::clear_compare_saved,
            commands::compare::popout::open_compare_popout,
            commands::compare::popout::retarget_compare_popout,
            commands::compare::popout::popout_compare,
            commands::compare::popout::compare_popouts,
            commands::compare::reference::open_reference_window,
            commands::window::project::take_window_open_path,
            commands::window::project::open_project_window_at_path,
            commands::export::export_analysis,
            commands::export::export_all,
            commands::export::pick_save_path,
            commands::export::pick_directory,
            commands::export::write_text,
            commands::export::write_bytes,
            commands::ui::get_ui_state,
            commands::ui::set_ui_state,
            commands::project::save_project,
            commands::project::load_project,
            commands::project::pick_project_open_path,
            commands::project::pick_project_save_path,
            commands::project::open_paths::take_pending_open_paths,
            commands::project::open_paths::add_recent_project,
            commands::project::siblings::adjacent_project,
            commands::project::siblings::adjacent_projects,
            commands::window::open_project_window,
            commands::window::open_popout_window,
            commands::window::sync_popouts,
            commands::window::close_popouts,
            commands::window::open_annotation_window,
            commands::window::popout_tool,
            commands::window::popout_annotation,
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
            commands::app::e2e_enabled,
            commands::cli_install::cli_tool_status,
            commands::cli_install::cli_tool_install,
            commands::cli_install::cli_tool_uninstall,
            #[cfg(desktop)]
            commands::update::check_update,
            #[cfg(desktop)]
            commands::update::install_update,
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
        tauri::RunEvent::Exit => {
            // `Exit` can also be emitted when the app stops before `setup` ran.
            if let Some(mcp) = app.try_state::<mcp::settings::McpController>() {
                mcp.stop(app);
            }
        }
        #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
        tauri::RunEvent::Opened { urls } => {
            let paths = commands::project::opened_paths_from_urls(urls);
            commands::project::handle_open_paths(app, paths);
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::log_targets;

    /// A CLI entry never opens the log file: a sandboxed or concurrent headless run used
    /// to abort on the log path (hey-listen-report §2.3).
    #[test]
    fn a_cli_entry_logs_to_stderr_only() {
        let targets = log_targets(true);
        assert_eq!(targets.len(), 1);
    }

    /// The GUI keeps both its stderr mirror and its rotated log file.
    #[test]
    fn the_gui_keeps_its_log_file() {
        assert_eq!(log_targets(false).len(), 2);
    }
}
