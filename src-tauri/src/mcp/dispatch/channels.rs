//! `run_analysis { channels: [...] }` — one envelope per output channel.
//!
//! A filter graph can carry several output channels (bands, stems), and the analysis
//! `channel` is a single shared setting: comparing them would otherwise be one call per
//! band. The sweep runs the same call per channel and nests the envelopes.

use serde_json::{json, Value};

use super::HeadlessSession;

impl HeadlessSession {
    /// Run the request once per channel, under `channels`.
    ///
    /// Each entry is a normal `run_analysis` envelope (its `params.channel` echoed), run
    /// **transiently**: a sweep would otherwise leave the last channel behind as the
    /// session's setting. The channel is the only key it overrides.
    pub(super) fn run_analysis_channels(
        &mut self,
        args: &Value,
        channels: &[usize],
    ) -> Result<Value, String> {
        let tool = args.get("tool").cloned().unwrap_or(Value::Null);
        let mut entries = Vec::with_capacity(channels.len());
        for channel in channels {
            let mut one = args.clone();
            if let Value::Object(map) = &mut one {
                let mut params = map
                    .get("params")
                    .and_then(Value::as_object)
                    .cloned()
                    .unwrap_or_default();
                params.insert("channel".to_string(), json!(channel));
                map.insert("params".to_string(), Value::Object(params));
                map.insert("transient".to_string(), Value::Bool(true));
            }
            let mut envelope = self.run_analysis_one(&one)?;
            if let Value::Object(map) = &mut envelope {
                map.insert("channel".to_string(), json!(channel));
            }
            entries.push(envelope);
        }
        Ok(json!({ "tool": tool, "channels": entries }))
    }
}
