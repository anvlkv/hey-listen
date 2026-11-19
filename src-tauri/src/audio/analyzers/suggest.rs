//! "Did you mean?" hints for an id or option key that failed to parse (D-10).
//!
//! A boundary parse rejects an unknown id outright; naming the closest declared id turns
//! a dead end into a one-token fix. The distance is a restricted Damerau–Levenshtein
//! (optimal string alignment) over lowercased characters, so casing and one transposition
//! each cost a single edit and no dictionary or dependency is involved.

use strum::VariantNames;

use super::{AnalyzerId, ToolId};

/// The furthest edit distance that still reads as a typo rather than another word.
const MAX_DISTANCE: usize = 2;

/// The closest candidate to `input` (case-insensitive Damerau–Levenshtein ≤ 2), or
/// `None`.
///
/// An exact (lowercased) match returns `None`: the caller already holds that value, so
/// echoing it back as a suggestion would add nothing. Ties keep the first candidate.
pub fn nearest<'a>(input: &str, candidates: impl IntoIterator<Item = &'a str>) -> Option<String> {
    let input: Vec<char> = input.to_lowercase().chars().collect();
    let mut best: Option<(usize, &'a str)> = None;
    for candidate in candidates {
        let other: Vec<char> = candidate.to_lowercase().chars().collect();
        if other.len().abs_diff(input.len()) > MAX_DISTANCE {
            continue;
        }
        let distance = distance(&input, &other);
        if distance == 0 || distance > MAX_DISTANCE {
            continue;
        }
        if best.is_none_or(|(current, _)| distance < current) {
            best = Some((distance, candidate));
        }
    }
    best.map(|(_, candidate)| candidate.to_string())
}

/// The agent-facing `unknown analyzer` error, naming the nearest declared id when the
/// value is a near miss of one.
pub fn unknown_analyzer(value: &str) -> String {
    hint(
        format!("unknown analyzer: {value}"),
        nearest(value, AnalyzerId::VARIANTS.iter().copied()),
    )
}

/// The agent-facing `unknown tool` error, naming the nearest declared tab id when the
/// value is a near miss of one.
pub fn unknown_tool(value: &str) -> String {
    hint(
        format!("unknown tool: {value}"),
        nearest(value, ToolId::VARIANTS.iter().copied()),
    )
}

/// `message`, with a `(did you mean {suggestion}?)` suffix when there is one.
pub fn hint(message: String, suggestion: Option<String>) -> String {
    match suggestion {
        Some(suggestion) => format!("{message} (did you mean {suggestion}?)"),
        None => message,
    }
}

/// The optimal-string-alignment distance over two character slices.
fn distance(a: &[char], b: &[char]) -> usize {
    let mut table = vec![vec![0usize; b.len() + 1]; a.len() + 1];
    for (index, row) in table.iter_mut().enumerate() {
        row[0] = index;
    }
    for (index, cell) in table[0].iter_mut().enumerate() {
        *cell = index;
    }
    for i in 1..=a.len() {
        for j in 1..=b.len() {
            let substitution = usize::from(a[i - 1] != b[j - 1]);
            let mut best = (table[i - 1][j] + 1)
                .min(table[i][j - 1] + 1)
                .min(table[i - 1][j - 1] + substitution);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                best = best.min(table[i - 2][j - 2] + 1);
            }
            table[i][j] = best;
        }
    }
    table[a.len()][b.len()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_exact_match_has_no_hint() {
        assert_eq!(nearest("spectrum", ["spectrum", "spectrogram"]), None);
    }

    #[test]
    fn a_transposition_is_suggested() {
        assert_eq!(
            nearest("specturm", ["spectrum", "waveform"]),
            Some("spectrum".to_string())
        );
    }

    #[test]
    fn a_snake_case_alias_finds_the_camel_case_key() {
        assert_eq!(
            nearest("min_f0_hz", ["minF0Hz", "maxF0Hz"]),
            Some("minF0Hz".to_string())
        );
    }

    #[test]
    fn a_distant_value_has_no_hint() {
        assert_eq!(nearest("zzzz", ["spectrum", "waveform"]), None);
    }
}
