//! Headless project-file tools: `save_project` / `open_project` / `new_project`.
//!
//! The binary format is Rust-owned ([`crate::project`]), so the headless session can
//! write a real `.heyl` without a webview. It fills `META`/`SETUP` from the session
//! (source, shared params, per-tool options, window/view, filter) and accepts the
//! annotations (`notes`) the caller supplies. `LAYOUT` is empty: there is no
//! Workbench in headless mode, so there is nothing to restore.
//!
//! `embedSource: false` writes a **reference** project: the `SOURCE` descriptor keeps
//! the file path and the `DATA` section is empty. `open_project` (and the GUI loader)
//! decodes the referenced file again on load — useful when a batch produces hundreds
//! of annotation projects and embedding every recording would be wasteful.

use std::collections::BTreeMap;
use std::fs::File;
use std::io::BufWriter;
use std::path::Path;

use serde_json::{json, Map, Value};

use crate::audio::analysis::{canonical_option_key, ToolOptions};
use crate::audio::analyzers::is_analyzer;
use crate::project::{
    read_project, write_project, AnalysisSetup, AnalysisWindow, Note, SaveProject, SourceDescriptor,
};

use super::args::{default_params, merge_options};
use super::HeadlessSession;

impl HeadlessSession {
    /// Write the session's current project to `path`.
    ///
    /// Arguments: `path` (required), `name`, `notes` (an array of `Note` objects;
    /// `id`/`createdMs`/`updatedMs` default harmlessly), `openTools` (tool ids to
    /// restore when the app opens the file), and `embedSource` (default `true`).
    pub(super) fn save_project(&mut self, args: &Value) -> Result<Value, String> {
        let path = args
            .get("path")
            .and_then(Value::as_str)
            .ok_or("`path` is required")?
            .to_string();
        let now = crate::recent::now_ms();
        let name = args
            .get("name")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| {
                Path::new(&path)
                    .file_stem()
                    .and_then(|stem| stem.to_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "Untitled project".to_string());
        let notes = parse_notes(args.get("notes"), now)?;
        let open_tools = args
            .get("openTools")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .filter(|id| is_analyzer(id))
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        let embed_source = args
            .get("embedSource")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        // A reference project only makes sense for a file source: the loader can decode
        // the path again. Synths keep their rendered audio.
        let reference = !embed_source && self.source_path.is_some();
        let setup = self.analysis_setup(open_tools);
        let source = self.source_descriptor();
        let notes_len = notes.len();

        {
            let guard = self
                .state
                .audio
                .source
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            let save = SaveProject {
                name: name.clone(),
                created_ms: None,
                source,
                setup,
                // No Workbench in headless mode; leave the layout empty.
                layout: json!({ "dockview": Value::Null, "graphs": {}, "popouts": [] }),
                results: Vec::new(),
                notes,
                pcm: if reference { None } else { guard.as_ref() },
            };
            let file =
                File::create(&path).map_err(|err| format!("could not create {path}: {err}"))?;
            write_project(BufWriter::new(file), &save, now)
                .map_err(|err| format!("could not write {path}: {err}"))?;
        }

        self.project_path = Some(path.clone());
        self.project_name = Some(name.clone());
        Ok(json!({
            "path": path,
            "name": name,
            "embedded": !reference,
            "notes": notes_len,
        }))
    }

    /// Load a `.heyl` project into the session: source PCM (or the referenced file),
    /// shared params, per-tool options, and the window/view.
    pub(super) fn open_project(&mut self, args: &Value) -> Result<Value, String> {
        let path = args
            .get("path")
            .and_then(Value::as_str)
            .ok_or("`path` is required")?;
        let mut file = File::open(path).map_err(|err| format!("could not open {path}: {err}"))?;
        let loaded = read_project(&mut file).map_err(|err| err.to_string())?;

        let pcm = loaded
            .pcm
            .clone()
            .or_else(|| crate::project::decode_reference(loaded.source.as_ref()));
        self.state.audio.set_source(pcm);
        self.state.audio.set_filter(None);

        self.params = loaded.setup.shared;
        self.options.clear();
        for (tool, values) in &loaded.setup.tool_options {
            if !is_analyzer(tool) {
                continue;
            }
            // A GUI save stores every tool option, including display-only keys
            // (`showMean`, `logFreq`, …). The engine only takes canonical engine keys;
            // ignore the rest instead of failing to open the project.
            let patch: Map<String, Value> = values
                .iter()
                .filter(|(key, _)| canonical_option_key(key).is_some())
                .map(|(key, value)| (key.clone(), json!(value)))
                .collect();
            let mut options = ToolOptions::default();
            merge_options(&mut options, tool, &patch)?;
            self.options.insert(tool.clone(), options);
        }

        let window = (loaded.setup.window.start_secs, loaded.setup.window.end_secs);
        let view = (loaded.setup.view.start_secs, loaded.setup.view.end_secs);
        self.window = window;
        self.view = view;
        self.name = loaded.meta.name.clone();
        self.project_name = Some(loaded.meta.name);
        self.project_path = Some(path.to_string());
        self.synth = loaded
            .source
            .as_ref()
            .and_then(|source| source.graph.clone());
        self.source_path = loaded
            .source
            .as_ref()
            .and_then(|source| source.path.clone());
        Ok(self.get_state())
    }

    /// Reset the session to an empty project (the headless `new_project`).
    pub(super) fn new_project(&mut self) -> Result<Value, String> {
        self.state.audio.clear();
        self.state.audio.set_filter(None);
        self.params = default_params();
        self.options.clear();
        self.window = (0.0, 0.0);
        self.view = (0.0, 0.0);
        self.synth = None;
        self.source_path = None;
        self.project_path = None;
        self.project_name = None;
        self.name.clear();
        Ok(self.get_state())
    }

    /// The `SETUP` section for the current session.
    fn analysis_setup(&self, open_tools: Vec<String>) -> AnalysisSetup {
        let filter_enabled = self
            .state
            .audio
            .filter
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .is_some();
        AnalysisSetup {
            shared: self.params.clone(),
            tool_options: self
                .options
                .iter()
                .map(|(tool, options)| (tool.clone(), numeric_options(options)))
                .collect(),
            open_tools,
            window: AnalysisWindow {
                start_secs: self.window.0,
                end_secs: self.window.1,
            },
            view: AnalysisWindow {
                start_secs: self.view.0,
                end_secs: self.view.1,
            },
            filter_enabled,
        }
    }

    /// The `SOURCE` section: the opened file, or the rendered synth graph.
    fn source_descriptor(&self) -> Option<SourceDescriptor> {
        if let Some(path) = &self.source_path {
            return Some(SourceDescriptor {
                kind: "file".to_string(),
                path: Some(path.clone()),
                ..Default::default()
            });
        }
        self.synth.as_ref().map(|graph| SourceDescriptor {
            kind: "synth".to_string(),
            graph: Some(graph.clone()),
            ..Default::default()
        })
    }
}

/// The engine option values as the project's numeric map (dropping unset fields).
fn numeric_options(options: &crate::audio::analysis::ToolOptions) -> BTreeMap<String, f64> {
    serde_json::to_value(options)
        .ok()
        .and_then(|value| value.as_object().cloned())
        .map(|map| {
            map.into_iter()
                .filter_map(|(key, value)| value.as_f64().map(|number| (key, number)))
                .collect()
        })
        .unwrap_or_default()
}

/// Parse the `notes` argument, filling ids/timestamps the caller may omit.
fn parse_notes(value: Option<&Value>, now_ms: u64) -> Result<Vec<Note>, String> {
    let Some(value) = value.filter(|value| !value.is_null()) else {
        return Ok(Vec::new());
    };
    let items = value.as_array().ok_or("`notes` must be an array")?;
    let mut notes = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        let mut object = item
            .as_object()
            .cloned()
            .ok_or_else(|| format!("note {index} must be an object"))?;
        object
            .entry("id")
            .or_insert_with(|| json!(format!("headless-{now_ms:x}-{index}")));
        object.entry("createdMs").or_insert_with(|| json!(now_ms));
        object.entry("updatedMs").or_insert_with(|| json!(now_ms));
        object.entry("body").or_insert_with(|| json!(""));
        let note: Note = serde_json::from_value(Value::Object(object))
            .map_err(|err| format!("invalid note {index}: {err}"))?;
        notes.push(note);
    }
    Ok(notes)
}
