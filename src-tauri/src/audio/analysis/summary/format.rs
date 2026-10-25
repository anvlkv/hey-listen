//! Number formatting for the summary `text` line.
//!
//! Values are rendered with at most two decimals and no trailing zeros, so a count
//! stays an integer (`43`) and a frequency stays readable (`440`, `440.5`). `text` is
//! a convenience for humans; the `items` carry the exact numbers.

/// `"440 Hz"`, `"-6 dBFS"`, `"43"` — the value with its unit when it has one.
pub fn format_value(value: f64, unit: Option<&str>) -> String {
    let number = format_number(value);
    match unit {
        Some(unit) if !unit.is_empty() => format!("{number} {unit}"),
        _ => number,
    }
}

/// At most two decimals, trailing zeros trimmed.
pub fn format_number(value: f64) -> String {
    if !value.is_finite() {
        return "—".to_string();
    }
    // Keep a tiny negative/positive residue from rendering as `-0`.
    let rounded = if value.abs() < 0.005 { 0.0 } else { value };
    let mut text = format!("{rounded:.2}");
    if text.contains('.') {
        while text.ends_with('0') {
            text.pop();
        }
        if text.ends_with('.') {
            text.pop();
        }
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_trim_to_readable_forms() {
        assert_eq!(format_number(0.0), "0");
        assert_eq!(format_number(-0.0001), "0");
        assert_eq!(format_number(43.0), "43");
        assert_eq!(format_number(440.5), "440.5");
        assert_eq!(format_number(1.23456), "1.23");
        assert_eq!(format_number(-6.0), "-6");
    }

    #[test]
    fn units_are_appended_with_one_space() {
        assert_eq!(format_value(440.0, Some("Hz")), "440 Hz");
        assert_eq!(format_value(43.0, None), "43");
    }
}
