//! The argument surface the request mapping reads.
//!
//! The mapping (`build_request`) is written once against [`ArgSource`], so the console
//! binary's `clap` matches and the `tauri-plugin-cli` matches used by the tests resolve
//! a [`Request`](super::super::Request) through the same validation. The plugin adapter
//! is test-only: the app binary no longer declares the batch subcommands (ADR-29), it
//! keeps them as the reference the console binary must stay byte-identical to.

/// Read-only access to a parsed argument surface, by the `plugins.cli` argument name
/// (`b-offset`, `open-tool`, …).
pub trait ArgSource {
    /// A single value (`--start 1.5`).
    fn string(&self, name: &str) -> Option<String>;
    /// A repeatable value (`-t spectrum -t tempo`), in command-line order.
    fn strings(&self, name: &str) -> Vec<String>;
    /// Whether a boolean flag was given.
    fn flag(&self, name: &str) -> bool;
}

/// The `tauri-plugin-cli` matches (the interface the batch CLI was delivered with,
/// M10). Test-only: it is the reference the console binary's mapping is pinned to.
#[cfg(test)]
mod plugin_matches {
    use serde_json::Value;
    use tauri_plugin_cli::Matches;

    use super::ArgSource;

    impl ArgSource for Matches {
        fn string(&self, name: &str) -> Option<String> {
            self.args
                .get(name)
                .and_then(|arg| arg.value.as_str())
                .map(str::to_string)
        }

        fn strings(&self, name: &str) -> Vec<String> {
            self.args
                .get(name)
                .and_then(|arg| arg.value.as_array())
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default()
        }

        fn flag(&self, name: &str) -> bool {
            self.args
                .get(name)
                .and_then(|arg| arg.value.as_bool())
                .unwrap_or(false)
        }
    }
}
