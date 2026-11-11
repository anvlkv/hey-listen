//! `-o` option-patch parsing: scoping, canonicalization and rejection.

use super::*;

// --- `-o` option patches ----------------------------------------------

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
    assert_eq!(request.options[0].tool, AnalyzerId::Spectrum);
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
    assert_eq!(request.options[0].tool, AnalyzerId::PitchYin);
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
