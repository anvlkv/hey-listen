//! Shared test-only helpers.
//!
//! A fixture that two test modules would otherwise copy belongs here (the clone gate
//! treats the second copy as a clone — see `AGENTS.md` → No copied blocks).

use std::io::{self, Write};

/// A writer that refuses every byte, like a full disk or a closed pipe.
pub struct FailingWriter;

impl Write for FailingWriter {
    fn write(&mut self, _buffer: &[u8]) -> io::Result<usize> {
        Err(io::Error::other("disk full"))
    }

    fn flush(&mut self) -> io::Result<()> {
        Err(io::Error::other("disk full"))
    }
}
