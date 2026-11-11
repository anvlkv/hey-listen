//! Folding the final stdout flush into the process exit code (audit P2 #12).

/// Fold the final stdout flush into the exit code, so a buffered write that fails at exit
/// is not reported as success.
pub(crate) fn finish(code: i32, flushed: std::io::Result<()>) -> i32 {
    match flushed {
        Ok(()) => code,
        Err(err) => {
            eprintln!("hey-listen: could not write the output: {err}");
            if code == 0 {
                1
            } else {
                code
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::finish;

    #[test]
    fn a_failed_final_flush_is_not_success() {
        let error = std::io::Error::other("disk full");
        assert_eq!(finish(0, Err(error)), 1);
    }

    #[test]
    fn a_failed_flush_keeps_an_existing_failure() {
        assert_eq!(finish(2, Err(std::io::Error::other("disk full"))), 2);
    }

    #[test]
    fn a_clean_flush_keeps_the_code() {
        assert_eq!(finish(0, Ok(())), 0);
        assert_eq!(finish(1, Ok(())), 1);
    }
}
