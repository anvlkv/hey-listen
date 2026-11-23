import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { errorMessage, invoke } from "../../lib/ipc";
import type { LogPath } from "../../bindings/LogPath";
import type { LogTail } from "../../bindings/LogTail";
import SelectTrigger, { type SelectOption } from "../SelectTrigger";

/**
 * The log preview's list (ADR-33).
 *
 * It **polls** `read_log_tail` while the window is visible instead of subscribing to
 * `log://log`: the stream is broadcast to every window and would have to be reconciled
 * with the history already on disk (a gap, and duplicates at the join), while one bounded
 * read per second is cheap — the file is capped before it rotates, and a rotation mid-poll
 * only means the next read is the new file's tail.
 *
 * The list is read-only: a level floor, a text filter, Follow, Copy and Open Log Folder.
 */

/** How often the file is re-read (the plugin flushes per record, so this is live enough). */
const POLL_MS = 1_000;

/** The level floor's choices, quietest first — the index is the comparison key. */
const LEVELS = ["trace", "debug", "info", "warn", "error"] as const;
type Level = (typeof LEVELS)[number];

const LEVEL_OPTIONS: SelectOption<Level>[] = LEVELS.map((level) => ({
  value: level,
  label: level[0].toUpperCase() + level.slice(1),
}));

/** The plugin's default record format: `[date][time][target][LEVEL] message`. */
const LEVEL_OF = /^\[[^\]]*\]\[[^\]]*\]\[[^\]]*\]\[([A-Z]+)\]/;

/** The level a record line was written at, or `null` for a line that has none. */
function levelOf(line: string): Level | null {
  const match = LEVEL_OF.exec(line);
  const level = match?.[1].toLowerCase() ?? "";
  return (LEVELS as readonly string[]).includes(level) ? (level as Level) : null;
}

export default function LogView() {
  const [lines, setLines] = createSignal<string[]>([]);
  const [truncated, setTruncated] = createSignal(false);
  const [floor, setFloor] = createSignal<Level>("info");
  const [query, setQuery] = createSignal("");
  const [follow, setFollow] = createSignal(true);
  const [path, setPath] = createSignal<LogPath | null>(null);
  const [error, setError] = createSignal("");
  const [copied, setCopied] = createSignal(false);
  let list: HTMLDivElement | undefined;

  const levelOption = () => LEVEL_OPTIONS.find((option) => option.value === floor());

  /** The lines the list shows: the level floor and the text filter, in file order. */
  const shown = createMemo(() => {
    const minimum = LEVELS.indexOf(floor());
    const needle = query().trim().toLowerCase();
    return lines().filter((line) => {
      if (needle && !line.toLowerCase().includes(needle)) return false;
      const level = levelOf(line);
      // A line with no level prefix continues the record above it (a formatted stack or
      // object), so it stays with that record rather than being filtered on its own.
      return level ? LEVELS.indexOf(level) >= minimum : true;
    });
  });

  async function poll(): Promise<void> {
    try {
      const tail = await invoke<LogTail>("read_log_tail");
      setLines(tail.lines);
      setTruncated(tail.truncated);
      setError("");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  onMount(() => {
    void poll();
    void invoke<LogPath>("log_path")
      .then(setPath)
      .catch(() => {});
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, POLL_MS);
    onCleanup(() => clearInterval(timer));
  });

  // Follow: keep the newest record in view (also when Follow is switched back on).
  createEffect(() => {
    if (!follow()) return;
    void shown();
    queueMicrotask(() => {
      if (list) list.scrollTop = list.scrollHeight;
    });
  });

  /** Copy what the list shows, not the whole file. */
  async function copy(): Promise<void> {
    try {
      await writeText(shown().join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div class="log-view">
      <div class="log-toolbar">
        <input
          class="log-filter"
          type="search"
          placeholder="Filter…"
          aria-label="Filter"
          data-testid="log.filter"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
        <SelectTrigger
          class="log-level"
          triggerClass="log-level-trigger"
          options={LEVEL_OPTIONS}
          value={levelOption()}
          onChange={setFloor}
          placeholder="Info"
          ariaLabel="Level"
        />
        <button
          class="log-btn"
          classList={{ "is-on": follow() }}
          type="button"
          title="Scroll to the newest record"
          data-testid="log.follow"
          onClick={() => setFollow(!follow())}
        >
          Follow
        </button>
        <button class="log-btn" type="button" onClick={() => void copy()}>
          {copied() ? "Copied" : "Copy"}
        </button>
        <button
          class="log-btn"
          type="button"
          title="Reveal the log file in the file manager"
          data-testid="log.reveal"
          onClick={() => void invoke("open_log_dir").catch(() => {})}
        >
          Open Log Folder
        </button>
        <Show when={path()}>
          {(current) => (
            <span class="log-path" title={current().file}>
              {current().dir}
            </span>
          )}
        </Show>
      </div>
      <Show when={error()}>{(message) => <p class="log-error">{message()}</p>}</Show>
      <Show when={truncated()}>
        <p class="log-note">Showing the end of the file.</p>
      </Show>
      <div class="log-list" data-testid="log.list" ref={(el) => (list = el)}>
        <For each={shown()} fallback={<p class="log-empty">No log lines yet.</p>}>
          {(line) => (
            <div
              class="log-line"
              classList={{
                "is-warn": levelOf(line) === "warn",
                "is-error": levelOf(line) === "error",
              }}
            >
              {line}
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
