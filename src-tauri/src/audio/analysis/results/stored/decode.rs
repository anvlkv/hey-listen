//! Positional-field reading shared by the `postcard`-safe stored wrappers.
//!
//! `postcard` carries no field names, so every wrapper reads its fields in declaration
//! order. The trailing-field helpers are what let a file written before a field existed
//! still decode: when the buffer ends early, `opt` / `defaulted` return a value instead
//! of failing the load (the file's checksum rules out a corrupt value reaching them).

use std::marker::PhantomData;

use serde::de::SeqAccess;
use serde::Deserialize;

/// A cursor over one stored wrapper's fields.
pub(super) struct Fields<'v, 'de, A: SeqAccess<'de>> {
    seq: &'v mut A,
    expecting: &'static str,
    index: usize,
    _marker: PhantomData<&'de ()>,
}

impl<'v, 'de, A: SeqAccess<'de>> Fields<'v, 'de, A> {
    pub(super) fn new(seq: &'v mut A, expecting: &'static str) -> Self {
        Self {
            seq,
            expecting,
            index: 0,
            _marker: PhantomData,
        }
    }

    /// The next required field; a missing one is an `invalid_length` error.
    pub(super) fn req<T: Deserialize<'de>>(&mut self) -> Result<T, A::Error> {
        let value = self.seq.next_element()?.ok_or_else(|| {
            <A::Error as serde::de::Error>::invalid_length(self.index, &self.expecting)
        })?;
        self.index += 1;
        Ok(value)
    }

    /// An optional trailing field, `None` when the buffer ends early.
    pub(super) fn opt<T: Deserialize<'de>>(&mut self) -> Option<T> {
        self.index += 1;
        match self.seq.next_element::<Option<T>>() {
            Ok(Some(value)) => value,
            _ => None,
        }
    }

    /// A trailing field with a default, used when the buffer ends early.
    pub(super) fn defaulted<T: Deserialize<'de> + Default>(&mut self) -> T {
        self.index += 1;
        match self.seq.next_element::<T>() {
            Ok(Some(value)) => value,
            _ => T::default(),
        }
    }
}
