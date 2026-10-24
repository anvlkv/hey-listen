//! Tests for the result shaper (`compact` / `decimate`).

use serde_json::{json, Value};

use super::super::shape::{compact, decimate};

#[test]
fn compact_collapses_long_numeric_arrays() {
    let value = json!({ "values": (0..100).map(|n| n as f64).collect::<Vec<_>>() });
    let out = compact(value);
    assert_eq!(out["values"]["length"], 100);
    assert_eq!(out["values"]["min"], 0.0);
    assert_eq!(out["values"]["max"], 99.0);
    assert_eq!(out["values"]["argmin"], 0);
    assert_eq!(out["values"]["argmax"], 99);
    assert!(out["values"].get("nulls").is_none());
}

#[test]
fn compact_surfaces_gaps_in_a_long_array() {
    // A pitch track with one voiced frame out of 511 must be visible at a glance.
    let mut values: Vec<Value> = vec![Value::Null; 511];
    values[300] = json!(220.0);
    let out = compact(json!({ "values": values }));
    assert_eq!(out["values"]["length"], 511);
    assert_eq!(out["values"]["nulls"], 510);
    assert_eq!(out["values"]["min"], 220.0);
    assert_eq!(out["values"]["max"], 220.0);
    assert_eq!(out["values"]["argmin"], 300);
    assert_eq!(out["values"]["argmax"], 300);
}

#[test]
fn compact_reduces_other_long_arrays_to_their_length() {
    let values: Vec<Value> = (0..20).map(|n| json!(format!("f{n}"))).collect();
    let out = compact(json!({ "labels": values }));
    assert_eq!(out["labels"]["length"], 20);
}

#[test]
fn decimate_strides_keeping_first_and_last() {
    let value = json!({ "values": (0..100).map(|n| n as f64).collect::<Vec<_>>() });
    let out = decimate(value, 10);
    let values = out["values"].as_array().unwrap();
    assert_eq!(values.len(), 10);
    assert_eq!(values[0], 0.0);
    assert_eq!(values[9], 99.0);
    // A uniform stride of 11: index 1 lands on round(11) = 11.
    assert_eq!(values[1], 11.0);
    // Short arrays pass through untouched.
    let short = decimate(json!({ "values": [1.0, 2.0, 3.0] }), 10);
    assert_eq!(short["values"].as_array().unwrap().len(), 3);
}
