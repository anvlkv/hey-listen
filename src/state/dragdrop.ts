import { getCurrentWindow } from "@tauri-apps/api/window";
import { createSignal } from "solid-js";
import { openPath } from "./source";

/**
 * Drop-to-open wiring via Tauri's native window drag-and-drop events. The WebView
 * does not reliably expose local file paths through HTML5 `dataTransfer`, so we
 * use the window API and let symphonia (behind `probe_file`) decide real support.
 *
 * Note: Tauri's native handler consumes **every** drag over the WebView (its WRY
 * listener always returns `true` and never defers to WebKit), so an in-page HTML5
 * drag-and-drop would neither deliver its `drop` nor avoid this handler's overlay.
 * The graph editor's palette drag is therefore **pointer-based** — see
 * `components/GraphEditor.tsx`.
 */

/** True while a file is dragged over the window — drives the drop overlay. */
export const [dragActive, setDragActive] = createSignal(false);

/**
 * Extensions we optimistically accept. This is only a hint for picking a file out
 * of a multi-file drop; the backend rejects unsupported files, so we still try.
 */
const AUDIO_EXTENSIONS = new Set([
  "wav",
  "mp3",
  "flac",
  "ogg",
  "m4a",
  "aac",
  "aiff",
  "aif",
  "caf",
  "mp4",
  "mkv",
  "webm",
]);

function looksLikeAudio(path: string): boolean {
  const dot = path.lastIndexOf(".");
  return dot >= 0 && AUDIO_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

/**
 * Register the window drag-and-drop listener: raise the overlay on `enter`/`over`
 * and open the first dropped file on `drop` (replacing the source, like the Source
 * panel's "Open audio file…").
 *
 * Returns a disposable that unlistens. `onDragDropEvent` resolves to the unlisten
 * function asynchronously, so the disposable chains off that promise to stay
 * race-free if it is called before the listener is registered.
 */
export function initDragDrop(): () => void {
  const pending = getCurrentWindow().onDragDropEvent((event) => {
    const payload = event.payload;
    switch (payload.type) {
      case "enter":
      case "over":
        setDragActive(true);
        break;
      case "drop": {
        setDragActive(false);
        const path = payload.paths.find(looksLikeAudio) ?? payload.paths[0];
        if (path) void openPath(path);
        break;
      }
      case "leave":
        setDragActive(false);
        break;
    }
  });
  return () => void pending.then((unlisten) => unlisten());
}
