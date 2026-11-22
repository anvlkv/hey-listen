//! Catalog invariants and the generated frontend catalog.

use std::collections::HashSet;

use super::super::compile::make_unit;
use super::super::{GraphEdge, GraphNode, GraphSpec};
use super::{all, kind_arity, node, NodeDef};

/// A minimal inner graph for a subsystem kind: a generator for `resample`, else a
/// signal in → out chain.
fn seed_subgraph(kind: &str) -> GraphSpec {
    let node = |id: &str, kind: &str| GraphNode {
        id: id.to_string(),
        kind: kind.to_string(),
        params: Vec::new(),
        subgraph: None,
    };
    let (source, source_kind) = if kind == "resample" {
        ("osc", "sine")
    } else {
        ("in", "input")
    };
    GraphSpec {
        nodes: vec![node(source, source_kind), node("out", "output")],
        edges: vec![GraphEdge {
            from: source.to_string(),
            from_port: 0,
            to: "out".to_string(),
            to_port: 0,
        }],
    }
}

/// The `GraphNode` for `def` with `params`, seeding an inner graph where the kind
/// wraps one.
fn graph_node(def: &NodeDef, params: Vec<f32>) -> GraphNode {
    GraphNode {
        id: "n".to_string(),
        kind: def.kind.to_string(),
        params,
        subgraph: def.subsystem.then(|| Box::new(seed_subgraph(def.kind))),
    }
}

#[test]
fn every_catalog_kind_has_a_unit() {
    for def in all() {
        let params = def.params.iter().map(|param| param.default).collect();
        if let Err(err) = make_unit(&graph_node(def, params), "test", 48_000) {
            panic!("{}: {err}", def.kind);
        }
    }
}

/// Every kind must survive its own parameter range.
///
/// fundsp rejects some bounds outright (a zero all-pass delay asserts) and turns
/// others into NaN (a bell gain of zero goes through `sqrt`), so a range the catalog
/// offers must not be one the compiler cannot take. Build once at `min` and once at
/// `max`, then tick a steady signal and require a finite output.
#[test]
fn every_kind_stays_finite_at_its_param_bounds() {
    for def in all() {
        for extreme in ["min", "max"] {
            let params: Vec<f32> = def
                .params
                .iter()
                .map(|param| {
                    if extreme == "min" {
                        param.min
                    } else {
                        param.max
                    }
                })
                .collect();
            let mut unit = make_unit(&graph_node(def, params.clone()), "bounds", 48_000)
                .unwrap_or_else(|err| panic!("{} at {extreme}: {err}", def.kind));
            unit.set_sample_rate(48_000.0);
            let input = vec![0.5; unit.inputs()];
            let mut output = vec![0.0; unit.outputs()];
            for _ in 0..32 {
                unit.tick(&input, &mut output);
                assert!(
                    output.iter().all(|sample| sample.is_finite()),
                    "{} at {extreme} params {params:?}: non-finite output",
                    def.kind
                );
            }
        }
    }
}

#[test]
fn every_kind_is_unique_and_consistent() {
    let mut kinds = HashSet::new();
    for def in all() {
        assert!(kinds.insert(def.kind), "duplicate kind: {}", def.kind);
        assert_eq!(
            kind_arity(def.kind),
            Some((def.input_ports.len(), def.output_ports.len())),
            "{}",
            def.kind
        );

        let mut keys = HashSet::new();
        for param in def.params {
            assert!(
                keys.insert(param.key),
                "{}.{}: duplicate key",
                def.kind,
                param.key
            );
            assert!(
                param.min <= param.max,
                "{}.{}: min > max",
                def.kind,
                param.key
            );
            assert!(
                param.min <= param.default && param.default <= param.max,
                "{}.{}: default {} outside {}..{}",
                def.kind,
                param.key,
                param.default,
                param.min,
                param.max
            );
            assert!(
                param.step > 0.0,
                "{}.{}: non-positive step",
                def.kind,
                param.key
            );
        }

        if let Some(table) = def.table {
            let width = table.columns.len();
            assert!(width > 0, "{}: table with no columns", def.kind);
            assert!(
                table.default_rows.len().is_multiple_of(width),
                "{}: default rows are not whole rows",
                def.kind
            );
            assert!(
                table.default_rows.len() / width <= table.max_rows,
                "{}: default rows exceed max_rows",
                def.kind
            );
            for (index, value) in table.default_rows.iter().enumerate() {
                let column = &table.columns[index % width];
                assert!(
                    *value >= column.min && *value <= column.max,
                    "{}: default {} outside {}..{}",
                    def.kind,
                    value,
                    column.min,
                    column.max
                );
            }
            for column in table.columns {
                assert!(
                    column.min < column.max && column.step > 0.0,
                    "{}: {} column has an empty range or a non-positive step",
                    def.kind,
                    column.label
                );
            }
        }
    }
    assert!(!all().is_empty());
}

#[test]
fn anchor_kinds_keep_their_expected_shape() {
    let input = node("input").expect("input");
    assert!(input.filter_only && !input.synth_only);
    assert_eq!((input.input_ports.len(), input.output_ports.len()), (0, 1));
    let output = node("output").expect("output");
    assert_eq!(
        (output.input_ports.len(), output.output_ports.len()),
        (1, 0)
    );
}

/// Write the generated catalog the frontend palette imports as
/// `src/bindings/nodeCatalog.json` (ts-rs cannot export values, only types).
#[test]
fn export_node_catalog() {
    let mut dir = std::path::PathBuf::from(
        std::env::var("TS_RS_EXPORT_DIR").unwrap_or_else(|_| "src/bindings".to_string()),
    );
    if dir.is_relative() {
        // `.cargo/config.toml` sets this relative to the repo root; ts-rs and cargo
        // tests may run from `src-tauri/`.
        dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("repo root")
            .join(dir);
    }
    std::fs::create_dir_all(&dir).expect("bindings dir");
    let path = dir.join("nodeCatalog.json");
    let text = serde_json::to_string_pretty(all()).expect("catalog json");
    std::fs::write(&path, format!("{text}\n")).expect("write node catalog");
}
