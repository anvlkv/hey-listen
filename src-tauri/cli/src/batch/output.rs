//! JSONL output: one self-describing result object per file/tool.

use std::io::Write;

use serde_json::Value;

/// Write one result object (compact JSONL, or pretty-printed).
///
/// The write goes through the run's [`Output`] wrapper, which remembers the first I/O
/// failure so the process can exit non-zero (audit P2 #12).
pub(super) fn emit(out: &mut impl Write, value: &Value, pretty: bool) {
    let text = if pretty {
        serde_json::to_string_pretty(value)
    } else {
        serde_json::to_string(value)
    }
    .unwrap_or_default();
    let _ = writeln!(out, "{text}");
}

/// A writer that **records** the first I/O failure instead of dropping it.
///
/// A full destination or a broken stdout must not yield exit `0` with missing JSON, so
/// the run wraps its real stdout in this and turns a recorded failure into a non-zero
/// exit code. `Write` cannot report the error to the JSONL formatting macros mid-line
/// (there is nothing useful to do there), so the failure is latched and checked once.
pub(super) struct Output<'a, W: Write> {
    inner: &'a mut W,
    failed: bool,
}

impl<'a, W: Write> Output<'a, W> {
    pub(super) fn new(inner: &'a mut W) -> Self {
        Self {
            inner,
            failed: false,
        }
    }

    /// Whether any write or flush failed.
    pub(super) fn failed(&self) -> bool {
        self.failed
    }
}

impl<W: Write> Write for Output<'_, W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        match self.inner.write(buf) {
            Ok(written) => Ok(written),
            Err(_) => {
                self.failed = true;
                // Claim the bytes were accepted: the failure is reported once, at the end.
                Ok(buf.len())
            }
        }
    }

    fn write_all(&mut self, buf: &[u8]) -> std::io::Result<()> {
        if self.inner.write_all(buf).is_err() {
            self.failed = true;
        }
        Ok(())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        if self.inner.flush().is_err() {
            self.failed = true;
        }
        Ok(())
    }
}
