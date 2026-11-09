//! The energy-conserving STFT path through the analyzer dispatch (X1): the
//! psychoacoustic consumers sum power on the full-scale-sine −3.01 dBFS RMS
//! convention, unlike the amplitude/spectrum path.

use super::*;

#[test]
fn critical_bands_reads_a_full_scale_sine_on_the_rms_reference() {
    // A bin-centred 1 kHz sine at amplitude 1 has mean square 0.5, so the power path
    // puts −3.01 dBFS into the band holding the tone (not the amplitude path's 0 dBFS).
    let fft = 4096;
    let bin = 85; // 996.09 Hz at 48 kHz
    let hz = bin as f32 * RATE as f32 / fft as f32;
    let mono: Vec<f32> = (0..fft)
        .map(|i| (std::f32::consts::TAU * hz * i as f32 / RATE as f32).sin())
        .collect();
    let mut shared = params(fft);
    shared.window_fn = WindowKind::Rectangular;
    match run(
        AnalyzerId::CriticalBands,
        &mono,
        RATE,
        &shared,
        &ToolOptions::default(),
    )
    .expect("critical bands")
    {
        AnalysisResult::CriticalBands(result) => {
            let mut peak = f32::NEG_INFINITY;
            for value in &result.values {
                peak = peak.max(*value);
            }
            assert!((peak + 3.01).abs() < 0.2, "band peak = {peak} dBFS");
        }
        other => panic!("unexpected result: {other:?}"),
    }
}
