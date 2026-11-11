//! Project file migrations — see `docs/project-file-format.md` → Migrations and ADR-32.
//!
//! A **bump** of [`VERSION`](super::VERSION) adds one [`Step`] to [`STEPS`]. A step reads
//! the payloads of version `N` and rewrites the ones whose shape changed into version
//! `N + 1`, so each step knows only two adjacent versions; [`run`] applies them in order,
//! from the file's version up to the current one, before the payloads are decoded.
//!
//! The payloads arrive as raw `postcard` **bytes** ([`Sections`]) for exactly that reason:
//! an old file's `SETUP` may not decode into today's struct, so a step decodes it with its
//! own frozen type first. Everything that did not change at a hop passes through untouched,
//! and `DATA` is never migrated — the reader has already decoded it into the project.
//!
//! # Adding a step
//!
//! 1. Add `migrate/vN.rs` with a **frozen** copy of every payload type that changed at the
//!    hop (`vN::Meta`, …: a release snapshot, never edited afterwards) and a
//!    `from_vN_to_vNp1(&mut Sections)` that decodes each changed section with its frozen
//!    type, converts it to today's type and re-encodes it in place.
//! 2. Add that function to [`STEPS`], bump [`VERSION`](super::VERSION) (and
//!    [`MIN_READ_VERSION`](super::MIN_READ_VERSION) when the oldest readable version moves)
//!    and record the change in `docs/project-file-format.md` → Format version history.
//! 3. Add a test that a fixture written in version `N` loads with everything but `RESULTS`
//!    intact (see [`tests`]).
//!
//! A step must never drop or empty `SOURCE`, `DATA`, `SETUP`, `LAYOUT` or `ANNOTATIONS`:
//! those are the user's work. `RESULTS` is a cache and a `COMPARE` section is analysis
//! output, so either may be dropped (reported through [`DroppedSection`]).

use serde::de::DeserializeOwned;

use super::sections::{AnalysisSetup, Annotation, SourceDescriptor, StoredResult};
use super::{LoadedProject, ProjectError, VERSION};
use crate::audio::analysis::compare::SavedComparison;
use crate::state::SourceData;

mod v1;

#[cfg(test)]
mod tests;

/// A section a load had to **drop**: analysis output that is recomputed on demand, never
/// user data (`docs/project-file-format.md` → Migrations).
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::Display)]
#[strum(serialize_all = "camelCase")]
pub enum DroppedSection {
    /// The cached `RESULTS` of a pre-[`VERSION`] file.
    Results,
    /// A `COMPARE` section whose stored snapshots cannot be decoded.
    SavedComparisons,
}

/// A project file's sections as read: the structured payloads are still `postcard`
/// bytes, so a migration step can decode them with the version's own (frozen) type.
///
/// `DATA` and `LAYOUT` are already decoded — `DATA` is a raw blob no step transforms, and
/// the layout is JSON, which a step can read and patch field by field.
#[derive(Default)]
pub(crate) struct Sections {
    /// The version the payloads were written with (the file's header version).
    pub version: u32,
    pub meta: Option<Vec<u8>>,
    pub source: Option<Vec<u8>>,
    pub setup: Option<Vec<u8>>,
    pub layout: serde_json::Value,
    pub results: Option<Vec<u8>>,
    pub annotations: Option<Vec<u8>>,
    pub compare: Option<Vec<u8>>,
    /// The embedded audio; never migrated.
    pub pcm: Option<SourceData>,
    /// Analysis output that will not survive this load.
    pub dropped: Vec<DroppedSection>,
}

impl Sections {
    /// Decode a section payload into the type the step converts **from**.
    ///
    /// Steps share this so a payload decode error is reported the same way everywhere.
    pub(super) fn decode<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, ProjectError> {
        postcard::from_bytes(bytes).map_err(|err| ProjectError::Corrupt(format!("postcard: {err}")))
    }

    /// Encode a payload in the next version's layout.
    pub(super) fn encode<T: serde::Serialize>(value: &T) -> Result<Vec<u8>, ProjectError> {
        postcard::to_stdvec(value).map_err(|err| ProjectError::Encode(err.to_string()))
    }
}

/// One version-to-version migration step (ADR-32).
pub(crate) struct Step {
    /// The version the step reads; it leaves the sections at `from + 1`.
    pub from: u32,
    /// Rewrite every payload that changed at this hop, then bump `sections.version`.
    pub apply: fn(&mut Sections) -> Result<(), ProjectError>,
}

/// The migration chain, one step per bump in `MIN_READ_VERSION..VERSION` (ADR-32).
///
/// `tests::the_step_table_covers_every_hop` fails whenever a bump is not followed by its
/// step here. `v1` is the `COMPARE` snapshot layout change (`referencePath`).
const STEPS: &[Step] = &[Step {
    from: 1,
    apply: v1::from_v1_to_v2,
}];

/// Migrate and decode a read project file.
pub(crate) fn run(sections: Sections) -> Result<LoadedProject, ProjectError> {
    run_with(STEPS, VERSION, sections)
}

/// The chain itself, with the steps and the target version passed in so a test can drive
/// the machinery without a released older version (see [`tests`]).
fn run_with(
    steps: &[Step],
    target: u32,
    mut sections: Sections,
) -> Result<LoadedProject, ProjectError> {
    let source_version = sections.version;
    // Results are a cache, so a pre-current file never pays to migrate (or decode) them.
    if source_version < target && sections.results.take().is_some() {
        sections.dropped.push(DroppedSection::Results);
    }
    apply(steps, target, &mut sections)?;
    let mut loaded = decode(sections)?;
    loaded.format_version = source_version;
    loaded.upgraded_from = (source_version < target).then_some(source_version);
    Ok(loaded)
}

/// Apply every step from the sections' version up to `target`.
fn apply(steps: &[Step], target: u32, sections: &mut Sections) -> Result<(), ProjectError> {
    if sections.version > target {
        return Err(ProjectError::UnsupportedVersion(sections.version));
    }
    while sections.version < target {
        let from = sections.version;
        let step = steps
            .iter()
            .find(|step| step.from == from)
            .ok_or(ProjectError::MissingMigrationStep(from))?;
        (step.apply)(sections)?;
        if sections.version != from + 1 {
            return Err(ProjectError::Corrupt(format!(
                "the migration step for version {from} left the project at version {}",
                sections.version
            )));
        }
    }
    Ok(())
}

/// Decode the (now current-shaped) payloads into a [`LoadedProject`].
fn decode(sections: Sections) -> Result<LoadedProject, ProjectError> {
    let meta = sections
        .meta
        .as_deref()
        .ok_or_else(|| ProjectError::Corrupt("missing META section".to_string()))?;
    let embedded = sections.pcm.is_some();
    Ok(LoadedProject {
        meta: Sections::decode(meta)?,
        source: match sections.source.as_deref() {
            Some(bytes) => Sections::decode::<Option<SourceDescriptor>>(bytes)?,
            None => None,
        },
        setup: optional::<AnalysisSetup>(sections.setup)?.unwrap_or_default(),
        layout: sections.layout,
        results: optional::<Vec<StoredResult>>(sections.results)?.unwrap_or_default(),
        annotations: optional::<Vec<Annotation>>(sections.annotations)?.unwrap_or_default(),
        compare: optional::<Vec<SavedComparison>>(sections.compare)?.unwrap_or_default(),
        pcm: sections.pcm,
        embedded,
        format_version: sections.version,
        upgraded_from: None,
        dropped: sections.dropped,
    })
}

/// Decode an optional section: absent is `None`, a bad payload is a `Corrupt` error.
fn optional<T: DeserializeOwned>(bytes: Option<Vec<u8>>) -> Result<Option<T>, ProjectError> {
    bytes.map(|bytes| Sections::decode(&bytes)).transpose()
}
