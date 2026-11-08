//! The scalar readout results (integrated loudness and loudness range), split out of
//! [`super`] to keep each file inside the source-size budget.

use serde::{Deserialize, Serialize};

/// Integrated loudness (EBU R128).
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LufsResult {
    pub lufs: f32,
}

/// Loudness range (LRA), in LU.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LraResult {
    pub lra: f32,
}
