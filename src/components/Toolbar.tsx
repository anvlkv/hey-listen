import { invoke } from "@tauri-apps/api/core";
import { createSignal, onMount, Show } from "solid-js";
import { error, status } from "../state/source";

const STATUS_LABEL: Record<string, string> = {
  probing: "reading metadata…",
  decoding: "decoding audio…",
};

/**
 * App toolbar (no title/branding — the native title bar carries the app name).
 * Holds app-level status; the audio source picker lives in the bottom-left
 * Source region (see `docs/ui-layout.md`).
 */
export default function Toolbar() {
  const [backend, setBackend] = createSignal("…");

  onMount(() => {
    invoke<string>("ping")
      .then((msg) => setBackend(msg))
      .catch((err) => setBackend(`error: ${String(err)}`));
  });

  return (
    <header class="app-toolbar">
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
