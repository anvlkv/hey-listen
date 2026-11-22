//! Signal arithmetic: binary `A op B` nodes plus the unary `abs` / `invert`.

use super::{def, NodeDef};

pub(super) const MATH: &[NodeDef] = &[
    def!(
        "add",
        "Add",
        Math,
        ["A", "B"],
        ["out"],
        [],
        "Adds two signals (A + B)."
    ),
    def!(
        "subtract",
        "Subtract",
        Math,
        ["A", "B"],
        ["out"],
        [],
        "Subtracts B from A (A − B)."
    ),
    def!(
        "multiply",
        "Multiply",
        Math,
        ["A", "B"],
        ["out"],
        [],
        "Multiplies two signals (A × B) — ring-mod, or a VCA with a control input."
    ),
    def!(
        "divide",
        "Divide",
        Math,
        ["A", "B"],
        ["out"],
        [],
        "Divides A by B (A ÷ B)."
    ),
    def!(
        "min",
        "Minimum",
        Math,
        ["A", "B"],
        ["out"],
        [],
        "The lower of two signals, sample by sample."
    ),
    def!(
        "max",
        "Maximum",
        Math,
        ["A", "B"],
        ["out"],
        [],
        "The higher of two signals, sample by sample."
    ),
    def!(
        "abs",
        "Absolute",
        Math,
        ["in"],
        ["out"],
        [],
        "Rectifies the signal (|A|)."
    ),
    def!(
        "invert",
        "Invert",
        Math,
        ["in"],
        ["out"],
        [],
        "Flips the signal's polarity (−A)."
    ),
];
