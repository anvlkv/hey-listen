//! `Matches` → [`Request`] mapping (`build_request`).

use super::*;

// --- Matches -> Request mapping --------------------------------------

#[test]
fn analyze_maps_files_tools_params_and_window() {
    let m = matches(&[
        ("file", json!(["a.wav", "b.wav"])),
        ("tool", json!(["spectrum", "tempo"])),
        (
            "param",
            json!(["fftSize=8192", "windowFn=hamming", "randomizedOverlap=true"]),
        ),
        ("option", json!(["spectrum.nMels=40"])),
        ("start", json!("10")),
        ("end", json!("14")),
        ("full", json!(true)),
    ]);
    let request = build_request("analyze", &m).unwrap();
    assert!(matches!(&request.command, Command::Analyze));
    assert_eq!(request.files, ["a.wav", "b.wav"]);
    assert_eq!(request.tools, ["spectrum", "tempo"]);
    assert_eq!(request.start, Some(10.0));
    assert_eq!(request.end, Some(14.0));
    assert!(request.full);
    assert!(request
        .params
        .contains(&("fftSize".to_string(), json!(8192))));
    assert!(request
        .params
        .contains(&("windowFn".to_string(), json!("hamming"))));
    assert!(request
        .params
        .contains(&("randomizedOverlap".to_string(), json!(true))));
    assert_eq!(request.options.len(), 1);
    assert_eq!(request.options[0].tool, "spectrum");
    assert_eq!(request.options[0].key, "nMels");
    assert_eq!(request.options[0].value, json!(40));
}

#[test]
fn analyze_needs_a_file_and_a_tool() {
    assert!(build_request("analyze", &matches(&[])).is_err());

    let no_tool = matches(&[("file", json!(["a.wav"]))]);
    assert!(build_request("analyze", &no_tool).is_err());

    // `--all` satisfies the tool requirement.
    let all = matches(&[("file", json!(["a.wav"])), ("all", json!(true))]);
    assert!(build_request("analyze", &all).is_ok());
}

#[test]
fn bad_params_are_rejected() {
    let base = |param: &str| {
        matches(&[
            ("file", json!(["a.wav"])),
            ("tool", json!(["spectrum"])),
            ("param", json!([param])),
        ])
    };
    assert!(build_request("analyze", &base("nope=1"))
        .unwrap_err()
        .contains("unknown shared param"));
    assert!(build_request("analyze", &base("windowFn=triangular")).is_err());
    assert!(build_request("analyze", &base("fftSize=lots")).is_err());
    assert!(build_request("analyze", &base("fftSize")).is_err());
}

#[test]
fn option_without_a_tool_prefix_needs_a_single_tool() {
    let two = matches(&[
        ("file", json!(["a.wav"])),
        ("tool", json!(["spectrum", "tempo"])),
        ("option", json!(["nMels=40"])),
    ]);
    assert!(build_request("analyze", &two).is_err());

    let one = matches(&[
        ("file", json!(["a.wav"])),
        ("tool", json!(["spectrum"])),
        ("option", json!(["nMels=40"])),
    ]);
    let request = build_request("analyze", &one).unwrap();
    assert_eq!(request.options[0].tool, "spectrum");
}

#[test]
fn unknown_option_key_is_rejected() {
    let m = matches(&[
        ("file", json!(["a.wav"])),
        ("tool", json!(["spectrum"])),
        ("option", json!(["spectrum.nope=1"])),
    ]);
    assert!(build_request("analyze", &m)
        .unwrap_err()
        .contains("unknown option"));
}

#[test]
fn snake_case_option_aliases_are_canonicalized() {
    let m = matches(&[
        ("file", json!(["a.wav"])),
        ("tool", json!(["pitchYin"])),
        ("option", json!(["min_f0_hz=50"])),
    ]);
    let request = build_request("analyze", &m).unwrap();
    assert_eq!(request.options[0].tool, "pitchYin");
    assert_eq!(request.options[0].key, "minF0Hz");
    assert_eq!(request.options[0].value, json!(50));
}

#[test]
fn note_quality_option_aliases_are_canonicalized() {
    let m = matches(&[
        ("file", json!(["a.wav"])),
        ("tool", json!(["noteMetrics"])),
        (
            "option",
            json!(["pitch_frame_ms=30", "pitch_hop_ms=2", "max_f0_hz=3000"]),
        ),
    ]);
    let request = build_request("analyze", &m).unwrap();
    let keys: Vec<&str> = request
        .options
        .iter()
        .map(|option| option.key.as_str())
        .collect();
    assert_eq!(keys, ["pitchFrameMs", "pitchHopMs", "maxF0Hz"]);
    assert_eq!(request.options[0].value, json!(30));
    assert_eq!(request.options[1].value, json!(2));
    assert_eq!(request.options[2].value, json!(3000));
}

#[test]
fn pretty_needs_a_single_result() {
    let m = matches(&[
        ("file", json!(["a.wav", "b.wav"])),
        ("tool", json!(["spectrum"])),
        ("pretty", json!(true)),
    ]);
    assert!(build_request("analyze", &m)
        .unwrap_err()
        .contains("--pretty"));
}

#[test]
fn analyzers_reads_the_json_flag() {
    let m = matches(&[("json", json!(true))]);
    let request = build_request("analyzers", &m).unwrap();
    assert!(matches!(request.command, Command::Analyzers { json: true }));
}

#[test]
fn synth_reads_the_graph_and_seconds() {
    let path = write_synth_graph("hey_listen_cli_synth_graph.json");
    let m = matches(&[("graph", json!(path)), ("seconds", json!("2"))]);
    let request = build_request("synth", &m).unwrap();
    match request.command {
        Command::Synth {
            seconds, path: p, ..
        } => {
            assert_eq!(seconds, 2.0);
            assert_eq!(p, path);
        }
        _ => panic!("expected a synth command"),
    }
}

#[test]
fn synth_without_a_graph_is_a_usage_error() {
    assert!(build_request("synth", &matches(&[]))
        .unwrap_err()
        .contains("graph"));
}

#[test]
fn a_filter_graph_is_checked_when_it_is_mapped() {
    let path = std::env::temp_dir().join("hey_listen_cli_bad_filter.json");
    // A synth-style graph (no `input` anchor) is not a valid filter.
    std::fs::write(&path, serde_json::to_string(&sine_graph()).unwrap()).unwrap();
    let m = matches(&[
        ("file", json!(["a.wav"])),
        ("tool", json!(["levels"])),
        ("filter", json![path.to_string_lossy().into_owned()]),
    ]);
    assert!(build_request("analyze", &m)
        .unwrap_err()
        .contains("filter graph"));
    let _ = std::fs::remove_file(&path);
}
