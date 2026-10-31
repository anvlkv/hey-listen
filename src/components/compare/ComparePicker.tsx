import { Dialog } from "@kobalte/core/dialog";
import { For, Show } from "solid-js";
import Icon from "../Icon";
import {
  compareNotice,
  compareSaved,
  compareTargets,
  pickCompareTarget,
  pickSavedComparison,
  pickerTool,
  savedWindowLabel,
  setPickerTool,
  shapeLabel,
  targetWindowLabel,
} from "../../state/compare/picker";

/**
 * The **Compare with…** picker (M25).
 *
 * A modal dialog over the projects the comparison can reference: each shows its name,
 * source shape and analysis window; a project with no source is listed but disabled.
 * With one project open the caller shows a notice instead of this dialog (the picker
 * only opens when there is at least one target). See `docs/comparison.md`.
 */
export default function ComparePicker() {
  const open = () => pickerTool() != null;
  /** An open project whose display name matches a saved reference (a reconnect hint). */
  const openMatch = (name: string) =>
    compareTargets().find((target) => target.name === name) ?? null;

  return (
    <Dialog open={open()} onOpenChange={(next) => !next && setPickerTool(null)}>
      <Dialog.Portal>
        <Dialog.Overlay class="compare-overlay" />
        <Dialog.Content class="compare-dialog" data-testid="compare.picker">
          <header class="compare-dialog-head">
            <Dialog.Title class="compare-dialog-title">Compare with…</Dialog.Title>
            <Dialog.CloseButton class="about-close" aria-label="Close">
              <Icon name="xmark" />
            </Dialog.CloseButton>
          </header>
          <Dialog.Description class="compare-dialog-hint">
            Pick another open project, or the saved reference from the last comparison. Each side
            keeps its own source, filter, analysis window and params — the comparison is read-only.
          </Dialog.Description>
          <ul class="compare-targets">
            <Show when={compareSaved()}>
              {(saved) => (
                <li>
                  <button
                    type="button"
                    class="compare-target compare-target-saved"
                    data-testid="compare.target.saved"
                    onClick={() => {
                      const tool = pickerTool();
                      if (tool) void pickSavedComparison(tool);
                    }}
                  >
                    <span class="compare-target-name">Saved: {saved().referenceName}</span>
                    <span class="compare-target-meta">
                      {shapeLabel(saved().source)} · {savedWindowLabel(saved())} · saved
                    </span>
                  </button>
                  <Show when={openMatch(saved().referenceName)}>
                    {(target) => (
                      <p class="compare-dialog-hint" data-testid="compare.saved.hint">
                        “{target().name}” is open — pick it above to reconnect live (the saved
                        snapshot stays as it was).
                      </p>
                    )}
                  </Show>
                </li>
              )}
            </Show>
            <For each={compareTargets()}>
              {(target) => (
                <li>
                  <button
                    type="button"
                    class="compare-target"
                    data-testid={`compare.target.${target.label}`}
                    disabled={!target.ready}
                    title={target.ready ? undefined : "This project has no audio source yet"}
                    onClick={() => {
                      const tool = pickerTool();
                      if (tool) void pickCompareTarget(tool, target);
                    }}
                  >
                    <span class="compare-target-name">{target.name}</span>
                    <span class="compare-target-meta">
                      {shapeLabel(target.source)} · {targetWindowLabel(target)}
                      {target.hasFilter ? " · filtered" : ""}
                    </span>
                  </button>
                </li>
              )}
            </For>
          </ul>
          <Show when={compareTargets().length === 0 && !compareSaved()}>
            <p class="compare-dialog-hint">
              No other project is open and this project has no saved comparison. Use File → New
              Window, then compare again.
            </p>
          </Show>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}

/** The transient hint shown when a comparison cannot open (no analyzer focused, one
 *  project open, or an M25.A-only family). Rendered by the Workbench. */
export function CompareNotice() {
  return (
    <Show when={compareNotice()}>
      {(text) => (
        <div class="compare-notice" role="status" data-testid="compare.notice">
          {text()}
        </div>
      )}
    </Show>
  );
}
