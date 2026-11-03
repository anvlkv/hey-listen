// Shared test fixture: a minimal 16-bit PCM WAV holding a half-scale 440 Hz sine.
//
// The unit tests (`audio::decode`, `cli::batch`) and the headless integration test
// all need the same file, so they `include!` this one source instead of each carrying
// a copy (see `docs/code-hygiene.md` → "No new duplication").

use std::path::Path;

/// Write a mono 16-bit PCM WAV with a half-scale 440 Hz sine.
#[allow(dead_code)] // used by some test targets but not all
pub fn write_sine_wav(path: &Path, rate: u32, frames: usize) {
    write_sine_wav_channels(path, rate, frames, 1);
}

/// Write a 16-bit PCM WAV with a half-scale 440 Hz sine in `channels` channels.
#[allow(dead_code)] // used by some test targets but not all
pub fn write_sine_wav_channels(path: &Path, rate: u32, frames: usize, channels: u16) {
    let bits = 16u16;
    let block_align = channels * bits / 8;
    let byte_rate = rate * u32::from(block_align);
    let data_len = frames as u32 * u32::from(block_align);

    let mut buf = Vec::new();
    buf.extend_from_slice(b"RIFF");
    buf.extend_from_slice(&(36 + data_len).to_le_bytes());
    buf.extend_from_slice(b"WAVE");
    buf.extend_from_slice(b"fmt ");
    buf.extend_from_slice(&16u32.to_le_bytes());
    buf.extend_from_slice(&1u16.to_le_bytes()); // PCM
    buf.extend_from_slice(&channels.to_le_bytes());
    buf.extend_from_slice(&rate.to_le_bytes());
    buf.extend_from_slice(&byte_rate.to_le_bytes());
    buf.extend_from_slice(&block_align.to_le_bytes());
    buf.extend_from_slice(&bits.to_le_bytes());
    buf.extend_from_slice(b"data");
    buf.extend_from_slice(&data_len.to_le_bytes());

    for frame in 0..frames {
        let t = frame as f32 / rate as f32;
        let sample = (t * 440.0 * std::f32::consts::TAU).sin() * 0.5;
        let value = (sample * f32::from(i16::MAX)) as i16;
        for _ in 0..channels {
            buf.extend_from_slice(&value.to_le_bytes());
        }
    }

    std::fs::write(path, buf).unwrap();
}
