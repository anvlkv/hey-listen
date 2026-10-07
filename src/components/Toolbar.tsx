import { invoke } from "@tauri-apps/api/core";
import { createSignal, onMount, Show } from "solid-js";
import { error, openFileDialog, source, status } from "../state/source";

const STATUS_LABEL: Record<string, string> = {
  probing: "reading metadata…",
  decoding: "decoding audio…",
};

/**
 * App toolbar (no title/branding — the native title bar carries the app name).
 * Holds app-level actions: open/replace the source, plus status.
 */
export default function Toolbar() {
  const [backend, setBackend] = createSignal("…");
  const busy = () => status() === "probing" || status() === "decoding";

  onMount(() => {
    invoke<string>("ping")
      .then((msg) => setBackend(msg))
      .catch((err) => setBackend(`error: ${String(err)}`));
  });

  return (
    <header class="app-toolbar">
      <button
        type="button"
        class="toolbar-btn"
        disabled={busy()}
        onClick={() => void openFileDialog()}
      >
        {source() ? "Replace audio file…" : "Open audio file…"}
      </button>

      <Show when={source()}>
        {(s) => (
          <span class="toolbar-source">
            {s().probe.name} · {s().probe.codec} · {s().sampleRate} Hz · {s().channels} ch
          </span>
        )}
      </Show>

      <Show when={STATUS_LABEL[status()]}>
        <span class="app-status">{STATUS_LABEL[status()]}</span>
      </Show>

      <div class="toolbar-spacer" />

      <Show when={error()}>
        <span class="app-status app-status-error" title={error() ?? undefined}>
          {error()}
        </span>
      </Show>
      <span class="app-status">Rust backend: {backend()}</span>
    </header>
  );
}
