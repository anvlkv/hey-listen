//! Version 6 → 7: `GraphNode` gains an optional nested `subgraph`.
//!
//! A subsystem node (M40) carries its inner graph on the node, so the `SOURCE`
//! descriptor's synth graph grows a field. `postcard` is positional, so a version-6
//! payload would read the following bytes as a `subgraph`; the step decodes `SOURCE`
//! with a frozen mirror and re-encodes it with `subgraph: None` on every node.
//!
//! `LAYOUT` is JSON (self-describing) and needs no rewrite: a version-6 layout simply
//! has no nested graphs. `DATA`, `SETUP`, `RESULTS`, `ANNOTATIONS` and `COMPARE` pass
//! through untouched.
//!
//! The frozen types are **release snapshots**: never edit them.

use serde::{Deserialize, Serialize};

use crate::audio::graph::{GraphEdge, GraphNode, GraphSpec};
use crate::project::sections::{SourceDescriptor, SourceKind};
use crate::project::ProjectError;

use super::Sections;

/// [`GraphNode`] as version 6 wrote it (no `subgraph`).
#[derive(Serialize, Deserialize)]
pub(super) struct GraphNodeV6 {
    id: String,
    kind: String,
    params: Vec<f32>,
}

/// [`GraphSpec`] as version 6 wrote it.
#[derive(Serialize, Deserialize)]
pub(super) struct GraphSpecV6 {
    nodes: Vec<GraphNodeV6>,
    edges: Vec<GraphEdge>,
}

/// [`SourceDescriptor`] as version 6 wrote it.
#[derive(Serialize, Deserialize)]
pub(super) struct SourceDescriptorV6 {
    kind: SourceKind,
    path: Option<String>,
    device_id: Option<String>,
    mix_mic_device_id: Option<String>,
    mix_system_device_id: Option<String>,
    target_pid: Option<u32>,
    gain: f32,
    graph: Option<GraphSpecV6>,
}

impl From<GraphNodeV6> for GraphNode {
    fn from(old: GraphNodeV6) -> Self {
        Self {
            id: old.id,
            kind: old.kind,
            params: old.params,
            subgraph: None,
        }
    }
}

impl From<GraphSpecV6> for GraphSpec {
    fn from(old: GraphSpecV6) -> Self {
        Self {
            nodes: old.nodes.into_iter().map(GraphNode::from).collect(),
            edges: old.edges,
        }
    }
}

impl From<SourceDescriptorV6> for SourceDescriptor {
    fn from(old: SourceDescriptorV6) -> Self {
        Self {
            kind: old.kind,
            path: old.path,
            device_id: old.device_id,
            mix_mic_device_id: old.mix_mic_device_id,
            mix_system_device_id: old.mix_system_device_id,
            target_pid: old.target_pid,
            gain: old.gain,
            graph: old.graph.map(GraphSpec::from),
            // A v6 file has no storage mode; the v7 step infers it from `DATA`.
            storage: crate::project::SourceStorage::Embedded,
            relative_path: None,
        }
    }
}

pub(super) fn from_v6_to_v7(sections: &mut Sections) -> Result<(), ProjectError> {
    if let Some(bytes) = sections.source.as_deref() {
        let migrated = match Sections::decode_exact::<Option<SourceDescriptor>>(bytes) {
            // A current payload under a v6 header (a test or a pre-release re-save) is
            // accepted unchanged, so the step never rejects a file it already migrated.
            Some(current) => current,
            None => {
                Sections::decode::<Option<SourceDescriptorV6>>(bytes)?.map(SourceDescriptor::from)
            }
        };
        sections.source = Some(Sections::encode(&migrated)?);
    }
    sections.version += 1;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v6_synth_source() -> SourceDescriptorV6 {
        SourceDescriptorV6 {
            kind: SourceKind::Synth,
            path: None,
            device_id: None,
            mix_mic_device_id: None,
            mix_system_device_id: None,
            target_pid: None,
            gain: 1.0,
            graph: Some(GraphSpecV6 {
                nodes: vec![
                    GraphNodeV6 {
                        id: "osc".to_string(),
                        kind: "sine".to_string(),
                        params: vec![440.0],
                    },
                    GraphNodeV6 {
                        id: "out".to_string(),
                        kind: "output".to_string(),
                        params: Vec::new(),
                    },
                ],
                edges: vec![GraphEdge {
                    from: "osc".to_string(),
                    from_port: 0,
                    to: "out".to_string(),
                    to_port: 0,
                }],
            }),
        }
    }

    #[test]
    fn a_version_6_source_graph_gains_no_subgraphs() {
        let mut sections = Sections {
            version: 6,
            source: Some(Sections::encode(&Some(v6_synth_source())).expect("source")),
            ..Sections::default()
        };

        from_v6_to_v7(&mut sections).expect("migrate");
        assert_eq!(sections.version, 7);

        let source = Sections::decode_exact::<Option<SourceDescriptor>>(
            sections.source.as_deref().expect("source survives"),
        )
        .expect("the current layout decodes exactly")
        .expect("a source");
        let graph = source.graph.expect("the synth graph survives");
        assert_eq!(graph.nodes.len(), 2);
        assert_eq!(graph.nodes[0].kind, "sine");
        assert!(graph.nodes[0].subgraph.is_none());
        assert_eq!(graph.edges.len(), 1);
    }

    #[test]
    fn a_current_source_payload_is_accepted_unchanged() {
        let current = SourceDescriptor {
            kind: SourceKind::File,
            path: Some("/tmp/a.wav".to_string()),
            ..SourceDescriptor::default()
        };
        let mut sections = Sections {
            version: 6,
            source: Some(Sections::encode(&Some(current)).expect("source")),
            ..Sections::default()
        };
        from_v6_to_v7(&mut sections).expect("migrate");
        let migrated = Sections::decode_exact::<Option<SourceDescriptor>>(
            sections.source.as_deref().expect("source survives"),
        )
        .expect("decodes")
        .expect("a source");
        assert_eq!(migrated.path.as_deref(), Some("/tmp/a.wav"));
    }
}
