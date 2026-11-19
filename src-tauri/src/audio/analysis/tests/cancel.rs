//! Progress + mid-run cancellation tests (D-21).
//!
//! A token that is never flipped must not change a result, a pre-cancelled token must
//! stop before the tool runs, and a cancel from another thread must end the run with
//! `Cancelled` rather than a panic or a whole result.

use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::audio::analysis::{
    run_window, run_window_with, AnalysisError, AnalysisPhase, Cancel, ToolOptions,
};
use crate::audio::analyzers::AnalyzerId;
use crate::state::{SourceData, WindowState};

use super::{params, tone, RATE};

/// A project window whose source is `mono`, so the run has a region to slice.
fn state_with(mono: Vec<f32>) -> Arc<WindowState> {
    let state = WindowState::default();
    *state
        .audio
        .source
        .lock()
        .unwrap_or_else(|poison| poison.into_inner()) = Some(SourceData {
        samples: mono,
        sample_rate: RATE,
        channels: 1,
    });
    Arc::new(state)
}

fn no_progress(_: AnalysisPhase, _: f32) {}

#[test]
fn an_inert_token_returns_the_run_window_result() {
    let state = state_with(tone(0.5, 440.0, 0.5));
    let options = ToolOptions::default();
    let shared = params(1024);
    let plain = run_window(&state, AnalyzerId::Spectrogram, 0.0, 0.4, &shared, &options)
        .expect("run_window");
    let cancellable = run_window_with(
        &state,
        AnalyzerId::Spectrogram,
        0.0,
        0.4,
        &shared,
        &options,
        &Cancel::never(),
        &no_progress,
    )
    .expect("run_window_with");
    assert_eq!(
        serde_json::to_value(&plain).expect("plain json"),
        serde_json::to_value(&cancellable).expect("cancellable json")
    );
}

#[test]
fn a_pre_cancelled_token_never_runs_the_tool() {
    // No source at all: reaching the slice would be `NoSource`, so `Cancelled` proves
    // the run stopped at the first check instead of starting the work.
    let state = WindowState::default();
    let cancel = Cancel::new();
    cancel.cancel();
    let error = run_window_with(
        &state,
        AnalyzerId::Spectrogram,
        0.0,
        1.0,
        &params(1024),
        &ToolOptions::default(),
        &cancel,
        &no_progress,
    )
    .expect_err("a cancelled run must not return a result");
    assert!(matches!(error, AnalysisError::Cancelled), "{error}");
}

#[test]
fn a_cancel_from_another_thread_ends_the_run_with_cancelled() {
    // A few seconds of audio: a spectrogram worth stopping. The worker signals as it
    // enters `Analysing`, so the cancel lands either just before the tool or while it
    // runs; either check on the way out must end the run with `Cancelled`.
    let state = state_with(tone(0.5, 440.0, 8.0));
    let cancel = Cancel::new();
    let (reached, reached_rx) = mpsc::channel();
    let worker = {
        let state = Arc::clone(&state);
        let cancel = cancel.clone();
        std::thread::spawn(move || {
            run_window_with(
                &state,
                AnalyzerId::Spectrogram,
                0.0,
                8.0,
                &params(1024),
                &ToolOptions::default(),
                &cancel,
                &move |phase, _| {
                    if phase == AnalysisPhase::Analysing {
                        let _ = reached.send(());
                    }
                },
            )
        })
    };

    // Wait until the worker is about to analyse, then flip the token from this thread:
    // the check on the far side of the report is what stops it.
    reached_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("the run reached Analysing");
    cancel.cancel();
    let error = worker
        .join()
        .expect("the run must not panic")
        .expect_err("the run must end cancelled");
    assert!(matches!(error, AnalysisError::Cancelled), "{error}");
}

#[test]
fn progress_starts_at_slicing_ends_at_done_and_never_goes_back() {
    let state = state_with(tone(0.5, 440.0, 0.5));
    let seen = Mutex::new(Vec::new());
    run_window_with(
        &state,
        AnalyzerId::Spectrogram,
        0.0,
        0.4,
        &params(2048),
        &ToolOptions::default(),
        &Cancel::never(),
        &|phase, fraction| {
            seen.lock()
                .unwrap_or_else(|poison| poison.into_inner())
                .push((phase, fraction))
        },
    )
    .expect("run");

    let seen = seen.lock().unwrap_or_else(|poison| poison.into_inner());
    assert_eq!(
        seen.first().map(|(phase, _)| *phase),
        Some(AnalysisPhase::Slicing)
    );
    assert_eq!(
        seen.last().map(|(phase, _)| *phase),
        Some(AnalysisPhase::Done)
    );
    assert!(
        seen.windows(2).all(|pair| pair[0].1 <= pair[1].1),
        "fractions must not go backwards: {seen:?}"
    );
    assert!(seen
        .iter()
        .any(|(phase, _)| *phase == AnalysisPhase::Analysing));
}

#[test]
fn the_phase_wire_spelling_is_camel_case() {
    // The frontend imports the generated union, so the spelling is pinned here.
    assert_eq!(
        serde_json::to_value(AnalysisPhase::Slicing).expect("json"),
        "slicing"
    );
    assert_eq!(
        serde_json::to_value(AnalysisPhase::Analysing).expect("json"),
        "analysing"
    );
    assert_eq!(
        serde_json::to_value(AnalysisPhase::Done).expect("json"),
        "done"
    );
}
