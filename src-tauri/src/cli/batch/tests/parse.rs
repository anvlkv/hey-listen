//! `Matches` → [`Request`] mapping (`build_request`).

use super::*;
use crate::export::ExportFormat;

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
fn analyzers_reads_the_json_and_id() {
    let m = matches(&[("json", json!(true))]);
    let request = build_request("analyzers", &m).unwrap();
    match request.command {
        Command::Analyzers {
            id: None,
            json: true,
        } => {}
        _ => panic!("expected the catalog with json"),
    }

    let m = matches(&[("id", json!("spectrum")), ("json", json!(true))]);
    let request = build_request("analyzers", &m).unwrap();
    match request.command {
        Command::Analyzers {
            id: Some(id),
            json: true,
        } => assert_eq!(id, "spectrum"),
        _ => panic!("expected one analyzer with json"),
    }
}

#[test]
fn summary_and_full_are_mutually_exclusive() {
    let m = matches(&[
        ("file", json!(["a.wav"])),
        ("tool", json!(["levels"])),
        ("summary", json!(true)),
        ("full", json!(true)),
    ]);
    assert!(build_request("analyze", &m)
        .unwrap_err()
        .contains("mutually exclusive"));

    let m = matches(&[
        ("file", json!(["a.wav"])),
        ("tool", json!(["levels"])),
        ("summary", json!(true)),
    ]);
    assert!(build_request("analyze", &m).unwrap().summary);
}

#[test]
fn export_flags_are_parsed_and_validated() {
    let dir = std::env::temp_dir();
    let m = matches(&[
        ("file", json!(["a.wav"])),
        ("tool", json!(["levels"])),
        ("format", json!("csv")),
        ("out", json![dir.to_string_lossy().into_owned()]),
    ]);
    let request = build_request("analyze", &m).unwrap();
    assert_eq!(request.format, ExportFormat::Csv);
    assert!(matches!(request.out, Some(OutputTarget::Dir(_))));

    let m = matches(&[
        ("file", json!(["a.wav"])),
        ("tool", json!(["levels"])),
        ("csv", json!(true)),
    ]);
    let request = build_request("analyze", &m).unwrap();
    assert_eq!(request.format, ExportFormat::Csv);

    // CSV on stdout can only be one result.
    let m = matches(&[
        ("file", json!(["a.wav", "b.wav"])),
        ("tool", json!(["levels"])),
        ("csv", json!(true)),
    ]);
    assert!(build_request("analyze", &m)
        .unwrap_err()
        .contains("exactly one result"));

    // A single output file likewise.
    let m = matches(&[
        ("file", json!(["a.wav", "b.wav"])),
        ("tool", json!(["levels"])),
        ("out", json!("out.csv")),
    ]);
    assert!(build_request("analyze", &m)
        .unwrap_err()
        .contains("exactly one result"));

    // An export needs the data, not a summary.
    let m = matches(&[
        ("file", json!(["a.wav"])),
        ("tool", json!(["levels"])),
        ("summary", json!(true)),
        ("out", json!("out.json")),
    ]);
    assert!(build_request("analyze", &m).is_err());

    // `--format json --csv` is ambiguous.
    let m = matches(&[
        ("file", json!(["a.wav"])),
        ("tool", json!(["levels"])),
        ("format", json!("json")),
        ("csv", json!(true)),
    ]);
    assert!(build_request("analyze", &m).is_err());
}

#[test]
fn analyze_reads_a_windows_file() {
    let path = std::env::temp_dir().join("hey_listen_cli_windows.txt");
    std::fs::write(
        &path,
        "# one window per line\n0,1\n 2 , 3, spectrum , levels\n\n4,5,levels\n",
    )
    .unwrap();
    let m = matches(&[
        ("file", json!(["a.wav"])),
        ("tool", json!(["levels"])),
        ("windows", json![path.to_string_lossy().into_owned()]),
    ]);
    let request = build_request("analyze", &m).unwrap();
    assert_eq!(request.windows.len(), 3);
    assert_eq!(request.windows[0].start, 0.0);
    assert_eq!(request.windows[0].end, 1.0);
    assert!(request.windows[0].tools.is_empty());
    assert_eq!(request.windows[1].tools, ["spectrum", "levels"]);
    assert_eq!(request.windows[2].start, 4.0);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn windows_can_carry_their_own_tools() {
    let path = std::env::temp_dir().join("hey_listen_cli_windows_tools.txt");
    std::fs::write(&path, "0,1,spectrum\n2,3,levels\n").unwrap();
    let m = matches(&[
        ("file", json!(["a.wav"])),
        ("windows", json![path.to_string_lossy().into_owned()]),
    ]);
    // Every line names its tool, so no `-t` is needed.
    assert!(build_request("analyze", &m).is_ok());
    let _ = std::fs::remove_file(&path);
}

#[test]
fn windows_reject_bad_lines_and_conflicts() {
    let run = |text: &str| {
        let path = std::env::temp_dir().join("hey_listen_cli_windows_bad.txt");
        std::fs::write(&path, text).unwrap();
        let m = matches(&[
            ("file", json!(["a.wav"])),
            ("tool", json!(["levels"])),
            ("windows", json![path.to_string_lossy().into_owned()]),
        ]);
        let result = build_request("analyze", &m);
        let _ = std::fs::remove_file(&path);
        result.map(|request| request.windows.len())
    };
    assert!(run("").unwrap_err().contains("no windows"));
    assert!(run("0\n").unwrap_err().contains("start,end"));
    assert!(run("0,x\n").unwrap_err().contains("invalid end"));
    assert!(run("2,1\n").unwrap_err().contains("end > start"));
    assert!(run("0,1,nope\n").unwrap_err().contains("unknown analyzer"));

    let path = std::env::temp_dir().join("hey_listen_cli_windows_conflict.txt");
    std::fs::write(&path, "0,1\n").unwrap();
    let m = matches(&[
        ("file", json!(["a.wav"])),
        ("tool", json!(["levels"])),
        ("windows", json![path.to_string_lossy().into_owned()]),
        ("start", json!("0")),
    ]);
    assert!(build_request("analyze", &m)
        .unwrap_err()
        .contains("not both"));
    let _ = std::fs::remove_file(&path);
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
