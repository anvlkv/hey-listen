//! Delta statistics shared by every result family (M25).
//!
//! A comparison reports **stats** by default and raw arrays only on request, so the
//! numbers here are the answer an agent (or the view's readouts) reads without the
//! arrays. See `docs/comparison.md` → "The delta".

use serde::Serialize;

/// The stats of a numeric delta (`B − A`), over the pairs where both sides exist.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeltaStats {
    /// Pairs compared (both sides present and finite).
    pub matched: usize,
    pub min: Option<f32>,
    pub max: Option<f32>,
    pub mean: Option<f32>,
    /// Root mean square of the delta — the magnitude, ignoring sign.
    pub rms: Option<f32>,
    /// The largest |Δ|.
    pub max_abs: Option<f32>,
    pub mean_abs: Option<f32>,
    /// Pearson correlation between A and B over the matched pairs.
    pub correlation: Option<f32>,
}

impl DeltaStats {
    /// Stats over `(a, b)` pairs; `B − A` is the delta.
    pub fn of(pairs: &[(f32, f32)]) -> Self {
        let mut matched = 0usize;
        let (mut min, mut max) = (f32::INFINITY, f32::NEG_INFINITY);
        let (mut sum, mut sum_abs, mut sum_sq) = (0.0f64, 0.0f64, 0.0f64);
        let (mut a_sum, mut b_sum, mut a_sq, mut b_sq, mut ab) =
            (0.0f64, 0.0f64, 0.0f64, 0.0f64, 0.0f64);
        for &(a, b) in pairs {
            if !a.is_finite() || !b.is_finite() {
                continue;
            }
            matched += 1;
            let delta = b - a;
            min = min.min(delta);
            max = max.max(delta);
            sum += f64::from(delta);
            sum_abs += f64::from(delta.abs());
            sum_sq += f64::from(delta) * f64::from(delta);
            a_sum += f64::from(a);
            b_sum += f64::from(b);
            a_sq += f64::from(a) * f64::from(a);
            b_sq += f64::from(b) * f64::from(b);
            ab += f64::from(a) * f64::from(b);
        }
        if matched == 0 {
            return Self::default();
        }
        let n = matched as f64;
        let mean = sum / n;
        let var_a = (a_sq / n - (a_sum / n).powi(2)).max(0.0);
        let var_b = (b_sq / n - (b_sum / n).powi(2)).max(0.0);
        let covariance = ab / n - (a_sum / n) * (b_sum / n);
        let correlation = if var_a > 0.0 && var_b > 0.0 {
            Some((covariance / (var_a.sqrt() * var_b.sqrt())) as f32)
        } else {
            // A perfectly flat side correlates with nothing (undefined), not 0.
            None
        };
        Self {
            matched,
            min: Some(min),
            max: Some(max),
            mean: Some(mean as f32),
            rms: Some((sum_sq / n).sqrt() as f32),
            max_abs: Some(min.abs().max(max.abs())),
            mean_abs: Some((sum_abs / n) as f32),
            correlation,
        }
    }

    /// `mean ±maxAbs over matched pairs`, for a summary line.
    pub fn describe(&self) -> String {
        match (self.mean, self.max_abs) {
            (Some(mean), Some(max_abs)) => {
                format!(
                    "Δ mean {mean:+.2} · max |Δ| {max_abs:.2} · {} pairs",
                    self.matched
                )
            }
            _ => "no comparable values".to_string(),
        }
    }
}

/// The `summary` + `maxAbs` fields every delta variant carries.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeltaHeader {
    /// One human-readable line (`Δ mean −1.2 dB · max |Δ| 3.4 dB · …`).
    pub summary: String,
    /// The largest absolute delta, when the family has one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_abs: Option<f32>,
}

impl DeltaHeader {
    pub fn new(summary: String, stats: &DeltaStats) -> Self {
        Self {
            summary,
            max_abs: stats.max_abs,
        }
    }

    /// A header with no numeric delta (e.g. windows that cannot be compared).
    pub fn text(summary: impl Into<String>) -> Self {
        Self {
            summary: summary.into(),
            max_abs: None,
        }
    }
}
