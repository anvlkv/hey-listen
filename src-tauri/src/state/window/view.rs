//! What a tool popout window shows (M7): a Workbench **tool** — an analyzer or one of
//! the graph editors — or one **subsystem** editor (`system:<parent>/<node>`, M40).
//!
//! The wire form is a single string, so the project file's `LAYOUT.popouts` and the IPC
//! keep their shape: a [`ToolId`]'s spelling for a tool, the scope for a subsystem. It is
//! parsed once here, at the boundary (ADR-28), and typed everywhere inside.

use std::fmt;
use std::str::FromStr;

use serde::de::{self, Deserialize, Deserializer};
use serde::ser::{Serialize, Serializer};

use crate::audio::analyzers::ToolId;

/// A subsystem scope's prefix (`systemScope` in `src/lib/graph/scope.ts`).
const SYSTEM_PREFIX: &str = "system:";

/// The view a popout window shows.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum PopoutView {
    /// A Workbench tool tab: an analyzer, or the filter / synth graph editor.
    Tool(ToolId),
    /// One subsystem's nested graph, by its scope (`system:<parent>/<node>`).
    System(String),
}

impl FromStr for PopoutView {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        if let Some(scope) = value.strip_prefix(SYSTEM_PREFIX) {
            if scope.is_empty() {
                return Err(format!("empty subsystem scope: {value}"));
            }
            return Ok(PopoutView::System(value.to_string()));
        }
        value.parse::<ToolId>().map(PopoutView::Tool).map_err(|_| {
            format!("unknown popout view: {value} (a tool id, or a subsystem scope `{SYSTEM_PREFIX}<parent>/<node>`)")
        })
    }
}

impl fmt::Display for PopoutView {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PopoutView::Tool(tool) => write!(formatter, "{tool}"),
            PopoutView::System(scope) => write!(formatter, "{scope}"),
        }
    }
}

impl Serialize for PopoutView {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for PopoutView {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = String::deserialize(deserializer)?;
        value.parse().map_err(de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wire(view: &PopoutView) -> String {
        serde_json::to_string(view).expect("serialize")
    }

    #[test]
    fn a_tool_view_is_its_tool_id() {
        let view: PopoutView = "filter".parse().expect("parse");
        assert_eq!(view, PopoutView::Tool(ToolId::Filter));
        assert_eq!(wire(&view), "\"filter\"");
        assert_eq!(
            serde_json::from_str::<PopoutView>("\"spectrum\"").expect("parse"),
            PopoutView::Tool(ToolId::Spectrum)
        );
    }

    #[test]
    fn a_subsystem_scope_is_a_view() {
        let view: PopoutView = "system:filter/n3".parse().expect("parse");
        assert_eq!(view, PopoutView::System("system:filter/n3".into()));
        assert_eq!(wire(&view), "\"system:filter/n3\"");
    }

    #[test]
    fn an_unknown_id_is_an_error() {
        assert!("nope".parse::<PopoutView>().is_err());
        assert!("system:".parse::<PopoutView>().is_err());
    }
}
