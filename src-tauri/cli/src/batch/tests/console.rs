//! The `hey-listen-cli` console binary's interface (`clap`) against the one it replaced.
//!
//! ADR-29 moved the batch subcommands off the app binary. This module pins the rehost:
//! the clap mapping is asserted through the real parser, and a representative command
//! set is resolved through **both** parsers — `clap` and the `tauri-plugin-cli` matches
//! the old `plugins.cli` produced — and compared (same [`Request`], same JSONL bytes).

use super::*;
use crate::batch::clap_args::{request, run as run_console, InvocationError};

/// Map a console command line onto a request (the first token is the binary name).
fn console_request(argv: &[&str]) -> Request {
    request(argv.iter().copied()).expect("the console mapping accepts this command line")
}

/// Assert that the console and the retired `plugins.cli` mapping resolve the same
/// request for one command line.
fn same_request(argv: &[&str], name: &str, entries: &[(&str, Value)]) {
    let console = console_request(argv);
    let plugin = build_request(name, &matches(entries)).expect("the plugin mapping");
    assert_eq!(
        format!("{console:?}"),
        format!("{plugin:?}"),
        "the two mappings disagree for {argv:?}"
    );
}

#[test]
fn analyze_maps_the_same_request_as_the_plugin() {
    same_request(
        &[
            "hey-listen-cli",
            "analyze",
            "a.wav",
            "b.wav",
            "-t",
            "spectrum",
            "-t",
            "tempo",
            "-p",
            "fftSize=8192",
            "-o",
            "spectrum.nMels=40",
            "--start",
            "10",
            "--end",
            "14",
            "--full",
        ],
        "analyze",
        &[
            ("file", json!(["a.wav", "b.wav"])),
            ("tool", json!(["spectrum", "tempo"])),
            ("param", json!(["fftSize=8192"])),
            ("option", json!(["spectrum.nMels=40"])),
            ("start", json!("10")),
            ("end", json!("14")),
            ("full", json!(true)),
        ],
    );
}

#[test]
fn the_long_aliases_are_the_same_flags() {
    same_request(
        &[
            "hey-listen-cli",
            "analyze",
            "a.wav",
            "--tool",
            "levels",
            "--param",
            "windowFn=hamming",
            "--option",
            "levels.gateDb=20",
            "--summary",
            "--fail-fast",
        ],
        "analyze",
        &[
            ("file", json!(["a.wav"])),
            ("tool", json!(["levels"])),
            ("param", json!(["windowFn=hamming"])),
            ("option", json!(["levels.gateDb=20"])),
            ("summary", json!(true)),
            ("fail-fast", json!(true)),
        ],
    );
}

#[test]
fn the_export_flags_and_a_windows_file_are_the_same() {
    let dir = std::env::temp_dir();
    let windows = dir.join("hey_listen_cli_console_windows.txt");
    std::fs::write(&windows, "0,1,spectrum\n2,3,levels\n").unwrap();
    let windows = windows.to_string_lossy().into_owned();
    let dir = dir.to_string_lossy().into_owned();

    same_request(
        &[
            "hey-listen-cli",
            "analyze",
            "a.wav",
            "--windows",
            windows.as_str(),
            "--csv",
            "--out",
            dir.as_str(),
        ],
        "analyze",
        &[
            ("file", json!(["a.wav"])),
            ("windows", json!(windows)),
            ("csv", json!(true)),
            ("out", json!(dir)),
        ],
    );
    let _ = std::fs::remove_file(&windows);
}

#[test]
fn compare_synth_project_and_the_small_subcommands_are_the_same() {
    let graph = write_synth_graph("hey_listen_cli_console_graph.json");

    same_request(
        &[
            "hey-listen-cli",
            "compare",
            "a.heyl",
            "b.heyl",
            "-t",
            "levels",
            "--a-start",
            "1",
            "--b-end",
            "2",
            "--b-offset=-0.25",
            "--overlap",
        ],
        "compare",
        &[
            ("a", json!("a.heyl")),
            ("b", json!("b.heyl")),
            ("tool", json!(["levels"])),
            ("a-start", json!("1")),
            ("b-end", json!("2")),
            ("b-offset", json!("-0.25")),
            ("overlap", json!(true)),
        ],
    );

    same_request(
        &[
            "hey-listen-cli",
            "synth",
            graph.as_str(),
            "--seconds",
            "2",
            "-t",
            "levels",
            "--pretty",
        ],
        "synth",
        &[
            ("graph", json!(graph)),
            ("seconds", json!("2")),
            ("tool", json!(["levels"])),
            ("pretty", json!(true)),
        ],
    );

    same_request(
        &[
            "hey-listen-cli",
            "project",
            "out.heyl",
            "--synth",
            graph.as_str(),
            "--seconds",
            "2",
        ],
        "project",
        &[
            ("dest", json!("out.heyl")),
            ("synth", json!(graph)),
            ("seconds", json!("2")),
        ],
    );
    let _ = std::fs::remove_file(&graph);

    same_request(
        &[
            "hey-listen-cli",
            "project",
            "out.heyl",
            "--source",
            "a.wav",
            "--name",
            "Mix",
            "--open-tool",
            "spectrum",
            "--reference",
        ],
        "project",
        &[
            ("dest", json!("out.heyl")),
            ("source", json!("a.wav")),
            ("name", json!("Mix")),
            ("open-tool", json!(["spectrum"])),
            ("reference", json!(true)),
        ],
    );

    same_request(
        &["hey-listen-cli", "analyzers", "spectrum", "--json"],
        "analyzers",
        &[("id", json!("spectrum")), ("json", json!(true))],
    );

    same_request(
        &[
            "hey-listen-cli",
            "annotations",
            "x.heyl",
            "--update",
            "n1",
            "--set",
            "title=New",
            "--set",
            "range=1,2",
            "--to",
            "copy.heyl",
        ],
        "annotations",
        &[
            ("file", json!("x.heyl")),
            ("update", json!("n1")),
            ("set", json!(["title=New", "range=1,2"])),
            ("to", json!("copy.heyl")),
        ],
    );
}

#[test]
fn the_console_reproduces_the_plugin_jsonl_byte_for_byte() {
    let path = std::env::temp_dir().join("hey_listen_cli_console.wav");
    write_sine_wav(&path, 8_000, 8_000);
    let file = path.to_string_lossy().into_owned();

    let console = console_request(&[
        "hey-listen-cli",
        "analyze",
        file.as_str(),
        "-t",
        "spectrum",
        "--start",
        "0",
        "--end",
        "1",
        "--full",
    ]);
    let plugin = build_request(
        "analyze",
        &matches(&[
            ("file", json!([file])),
            ("tool", json!(["spectrum"])),
            ("start", json!("0")),
            ("end", json!("1")),
            ("full", json!(true)),
        ]),
    )
    .unwrap();

    let mut from_console = Vec::new();
    let mut from_plugin = Vec::new();
    assert_eq!(run(&console, &mut from_console), 0);
    assert_eq!(run(&plugin, &mut from_plugin), 0);
    assert_eq!(from_console, from_plugin, "the JSONL envelope changed");

    let line = lines(&from_console).remove(0);
    assert_eq!(line["result"]["tool"], "spectrum");
    let peak = line["result"]["peakHz"].as_f64().unwrap();
    assert!((380.0..500.0).contains(&peak), "peak Hz: {peak}");
    let _ = std::fs::remove_file(&path);
}

/// Assert that a command line both parsers reject reports the same usage message.
fn same_usage_error(argv: &[&str], name: &str, entries: &[(&str, Value)]) {
    let Err(InvocationError::Usage(console)) = request(argv.iter().copied()) else {
        panic!("expected a usage error for {argv:?}");
    };
    let plugin = build_request(name, &matches(entries)).unwrap_err();
    assert_eq!(console, plugin, "the usage message changed for {argv:?}");
}

#[test]
fn usage_errors_keep_the_same_message() {
    same_usage_error(
        &["hey-listen-cli", "analyze", "-t", "levels"],
        "analyze",
        &[("tool", json!(["levels"]))],
    );
    same_usage_error(
        &["hey-listen-cli", "compare", "a.heyl", "b.heyl"],
        "compare",
        &[("a", json!("a.heyl")), ("b", json!("b.heyl"))],
    );
}

#[test]
fn the_exit_codes_are_the_documented_ones() {
    // `--help` prints the interface on stdout and is not an error.
    let mut out = Vec::new();
    assert_eq!(run_console(["hey-listen-cli", "--help"], &mut out), 0);
    let help = String::from_utf8_lossy(&out);
    assert!(help.contains("analyze"), "help: {help}");
    assert!(help.contains("compare"), "help: {help}");

    // A bad command line is a usage error (2) with nothing on stdout.
    let mut out = Vec::new();
    assert_eq!(run_console(["hey-listen-cli", "analyze"], &mut out), 2);
    assert!(out.is_empty());

    // A bare negative `--b-offset` is still two tokens: use `--b-offset=-0.25`.
    let mut out = Vec::new();
    assert_eq!(
        run_console(
            [
                "hey-listen-cli",
                "compare",
                "a.heyl",
                "b.heyl",
                "-t",
                "levels",
                "--b-offset",
                "-0.25"
            ],
            &mut out
        ),
        2
    );

    // An unknown `-t` id is not a parse error: one `error` record, exit 1.
    let path = std::env::temp_dir().join("hey_listen_cli_console_unknown.wav");
    write_sine_wav(&path, 8_000, 8_000);
    let file = path.to_string_lossy().into_owned();
    let mut out = Vec::new();
    assert_eq!(
        run_console(
            ["hey-listen-cli", "analyze", file.as_str(), "-t", "nope"],
            &mut out
        ),
        1
    );
    let records = lines(&out);
    assert_eq!(records.len(), 1);
    assert_eq!(records[0]["tool"], "nope");
    assert!(records[0]["error"]
        .as_str()
        .unwrap()
        .contains("unknown analyzer"));
    let _ = std::fs::remove_file(&path);
}
