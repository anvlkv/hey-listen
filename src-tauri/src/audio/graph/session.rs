//! A window's compiled synth net, reused across renders (M22).
//!
//! Every settled graph edit used to recompile the whole [`Net`] and re-render from
//! zero. A parameter-only edit does not change the graph's *topology*, so the net is
//! kept and only the nodes whose `params` moved are rebuilt, then spliced back in with
//! [`Net::crossfade`] (an immediate, backend-less swap). Structural edits — a node or
//! edge added, removed or reconnected — still rebuild, which is what
//! [`structure_key`] detects.

use std::collections::HashMap;
use std::fmt::Write;

use fundsp::prelude64::{AudioUnit, Fade, Net, NodeId};

use super::compile::{build_with_ids, make_unit};
use super::render::{frames, render_samples};
use super::{GraphError, GraphSpec};

/// A window's synth net: the compiled graph plus what it was compiled from.
#[derive(Default)]
pub struct SynthSession {
    net: Option<Net>,
    /// Graph node id → fundsp node id, for patching one node in place.
    ids: HashMap<String, NodeId>,
    /// The parameters each node was built with, so an edit can be diffed.
    params: HashMap<String, Vec<f32>>,
    /// [`structure_key`] of the compiled spec.
    structure: String,
    sample_rate: u32,
}

impl SynthSession {
    pub fn new() -> Self {
        Self::default()
    }

    /// Render `seconds` of `spec`, reusing the compiled net when its topology held.
    pub fn render(
        &mut self,
        spec: &GraphSpec,
        seconds: f64,
        sample_rate: u32,
    ) -> Result<Vec<f32>, GraphError> {
        self.sync(spec, sample_rate)?;
        let net = self.net.as_mut().expect("sync installed a net");
        net.reset();
        Ok(render_samples(net, frames(seconds, sample_rate)))
    }

    /// Rebuild on a structural (or sample-rate) change; otherwise patch the nodes whose
    /// parameters changed.
    fn sync(&mut self, spec: &GraphSpec, sample_rate: u32) -> Result<(), GraphError> {
        let structure = structure_key(spec);
        if self.net.is_none() || self.structure != structure || self.sample_rate != sample_rate {
            let (net, ids) = build_with_ids(spec, 0, sample_rate)?;
            self.net = Some(net);
            self.ids = ids;
            self.params = spec
                .nodes
                .iter()
                .map(|node| (node.id.clone(), node.params.clone()))
                .collect();
            self.structure = structure;
            self.sample_rate = sample_rate;
            return Ok(());
        }

        let mut patched = false;
        for node in &spec.nodes {
            if self.params.get(&node.id) == Some(&node.params) {
                continue;
            }
            let Some(id) = self.ids.get(&node.id).copied() else {
                continue;
            };
            if let Some(net) = self.net.as_mut() {
                net.crossfade(id, Fade::Smooth, 0.0, make_unit(node)?);
                patched = true;
            }
            self.params.insert(node.id.clone(), node.params.clone());
        }
        if patched {
            // A zero-length crossfade completes on the next processed sample; take it now
            // so the render below starts on the new unit (this sample is discarded).
            if let Some(net) = self.net.as_mut() {
                net.get_mono();
            }
        }
        Ok(())
    }
}

/// What makes a rebuild necessary: the nodes' ids and kinds, and every edge. The
/// parameters are deliberately absent — those are patched.
fn structure_key(spec: &GraphSpec) -> String {
    let mut key = String::new();
    for node in &spec.nodes {
        key.push_str(&node.id);
        key.push(':');
        key.push_str(&node.kind);
        key.push('|');
    }
    key.push_str("=>");
    for edge in &spec.edges {
        let _ = write!(
            key,
            "{}:{}>{}:{}|",
            edge.from, edge.from_port, edge.to, edge.to_port
        );
    }
    key
}

#[cfg(test)]
mod tests {
    use super::{structure_key, SynthSession};
    use crate::audio::graph::{GraphEdge, GraphNode, GraphSpec};

    fn node(id: &str, kind: &str, params: &[f32]) -> GraphNode {
        GraphNode {
            id: id.into(),
            kind: kind.into(),
            params: params.to_vec(),
        }
    }

    fn sine(hz: f32) -> GraphSpec {
        GraphSpec {
            nodes: vec![node("osc", "sine", &[hz]), node("out", "output", &[])],
            edges: vec![GraphEdge {
                from: "osc".into(),
                from_port: 0,
                to: "out".into(),
                to_port: 0,
            }],
        }
    }

    /// Zero crossings in `samples`, a cheap proxy for the dominant frequency.
    fn crossings(samples: &[f32]) -> usize {
        samples
            .windows(2)
            .filter(|pair| (pair[0] < 0.0) != (pair[1] < 0.0))
            .count()
    }

    #[test]
    fn a_parameter_edit_reuses_the_net() {
        let mut session = SynthSession::new();
        let low = session
            .render(&sine(220.0), 0.05, 48_000)
            .expect("first render");
        let high = session
            .render(&sine(440.0), 0.05, 48_000)
            .expect("patched render");

        assert_eq!(high.len(), 2_400);
        assert!(high.iter().all(|sample| sample.is_finite()));
        let (before, after) = (crossings(&low), crossings(&high));
        assert!(
            after > before * 3 / 2,
            "the patch did not double the pitch: {before} → {after} crossings"
        );
    }

    #[test]
    fn a_structural_edit_rebuilds() {
        let mut session = SynthSession::new();
        session
            .render(&sine(440.0), 0.01, 48_000)
            .expect("first render");

        let mixed = GraphSpec {
            nodes: vec![
                node("a", "sine", &[440.0]),
                node("b", "sine", &[660.0]),
                node("mix", "mix", &[]),
                node("out", "output", &[]),
            ],
            edges: vec![
                GraphEdge {
                    from: "a".into(),
                    from_port: 0,
                    to: "mix".into(),
                    to_port: 0,
                },
                GraphEdge {
                    from: "b".into(),
                    from_port: 0,
                    to: "mix".into(),
                    to_port: 1,
                },
                GraphEdge {
                    from: "mix".into(),
                    from_port: 0,
                    to: "out".into(),
                    to_port: 0,
                },
            ],
        };
        let out = session
            .render(&mixed, 0.01, 48_000)
            .expect("rebuilt render");
        assert_eq!(out.len(), 480);
        assert!(out.iter().any(|sample| sample.abs() > 0.1));
    }

    #[test]
    fn the_structure_key_ignores_parameters() {
        assert_eq!(structure_key(&sine(220.0)), structure_key(&sine(440.0)));
        let mut other = sine(440.0);
        other.nodes.push(node("extra", "dc", &[0.0]));
        assert_ne!(structure_key(&sine(440.0)), structure_key(&other));
    }
}
