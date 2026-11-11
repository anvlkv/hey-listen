//! A **real** version-1 project file migrates on load, and a save writes version 2.
//!
//! `e2e/fixtures/v1.heyl` was written by a 0.5.x build (header version 1, one embedded
//! stereo source, a saved setup/layout, an empty `RESULTS`). It is the fixture the
//! migration chain exists for: the loader must bring it forward unchanged, and the app
//! must be able to save it as `VERSION`.
//!
//! See `docs/project-file-format.md` → Migrations and ADR-32.

use std::io::Cursor;

use hey_listen_lib::project::{
    read_project, write_project, DroppedSection, LoadedProject, SaveProject, VERSION,
};

/// The committed version-1 fixture (`e2e/fixtures/v1.heyl`).
const FIXTURE: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../e2e/fixtures/v1.heyl"
));

fn load() -> LoadedProject {
    read_project(&mut Cursor::new(FIXTURE)).expect("the version-1 fixture loads")
}

#[test]
fn a_v1_project_migrates_with_its_work_intact() {
    let loaded = load();

    // The header version is reported, and the file is an upgrade (not a same-version read).
    assert_eq!(loaded.format_version, 1);
    assert_eq!(loaded.upgraded_from, Some(1));
    // Its `RESULTS` section is empty, so nothing the user could miss is lost.
    assert_eq!(loaded.dropped, vec![DroppedSection::Results]);
    assert!(loaded.results.is_empty());

    // The audio, source, setup and layout survive the hop.
    assert!(loaded.embedded);
    let pcm = loaded.pcm.as_ref().expect("the embedded audio");
    assert_eq!(pcm.sample_rate, 48_000);
    assert_eq!(pcm.channels, 2);
    assert!(!pcm.samples.is_empty());
    let source = loaded.source.as_ref().expect("the source descriptor");
    // The fixture is a 4.32 s live capture, so its audio is embedded (not a reference).
    assert_eq!(source.kind, hey_listen_lib::project::SourceKind::Mic);
    assert_eq!(loaded.setup.shared.fft_size, 2048);
    assert_eq!(loaded.setup.shared.hop, 0.25);
    assert_eq!(loaded.setup.window.end_secs, 4.24);
    assert!(
        !loaded.setup.open_tools.is_empty(),
        "the saved tabs survive"
    );
    assert!(
        loaded.layout.get("dockview").is_some(),
        "the layout survives"
    );
}

#[test]
fn a_migrated_v1_project_saves_as_the_current_version() {
    let loaded = load();
    let mut out = Cursor::new(Vec::new());
    write_project(&mut out, &SaveProject::from_loaded(&loaded), 1).expect("write");
    let bytes = out.into_inner();

    // The header (and `META`) now say `VERSION`.
    assert_eq!(u32::from_le_bytes(bytes[4..8].try_into().unwrap()), VERSION);

    let reread = read_project(&mut Cursor::new(bytes)).expect("re-read");
    assert_eq!(reread.format_version, VERSION);
    assert_eq!(reread.upgraded_from, None, "a saved file is not an upgrade");
    assert!(reread.dropped.is_empty());
    assert_eq!(reread.setup.open_tools, loaded.setup.open_tools);
    assert_eq!(reread.meta.name, loaded.meta.name);
    assert_eq!(reread.meta.created_ms, loaded.meta.created_ms);
    assert_eq!(
        reread.pcm.as_ref().map(|pcm| pcm.samples.len()),
        Some(loaded.pcm.as_ref().expect("pcm").samples.len())
    );
}
