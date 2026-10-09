import { Channel } from "@tauri-apps/api/core";

/**
 * Collect interleaved-`f32` PCM streamed over a Tauri [`Channel`].
 *
 * The core sends the samples in chunks and then a **zero-length sentinel**. Large
 * chunks are delivered asynchronously — Tauri routes a `Raw` payload above a size
 * threshold through a `fetch` round-trip (`ipc/channel.rs`) — so the command's
 * promise can resolve *before* the last chunk arrives. The channel orders messages
 * by index, so the sentinel's callback always runs after every chunk, which makes
 * awaiting [`PcmStream.done`] a reliable end-of-stream signal.
 */
export interface PcmStream {
  /** Pass to the command as its `onChunk` argument. */
  channel: Channel<ArrayBuffer>;
  /** Resolves once the core's end-of-stream sentinel has been received. */
  done: Promise<void>;
  /** Concatenate the received chunks — call only after `done` resolves. */
  samples: () => Float32Array;
}

/** Create a [`PcmStream`]; wire `channel` into the command's `onChunk` argument. */
export function pcmStream(): PcmStream {
  const chunks: Float32Array[] = [];
  let total = 0;
  let finish!: () => void;
  const done = new Promise<void>((resolve) => (finish = resolve));

  const channel = new Channel<ArrayBuffer>();
  channel.onmessage = (raw) => {
    // A zero-length chunk is the core's end-of-stream sentinel.
    if (raw.byteLength === 0) {
      finish();
      return;
    }
    const chunk = new Float32Array(raw);
    chunks.push(chunk);
    total += chunk.length;
  };

  return {
    channel,
    done,
    samples: () => {
      const out = new Float32Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
      }
      return out;
    },
  };
}
