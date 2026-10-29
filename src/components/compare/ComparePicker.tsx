import { Dialog } from "@kobalte/core/dialog";
import { For, Show } from "solid-js";
import Icon from "../Icon";
import {
  compareNotice,
  compareTargets,
  pickCompareTarget,
  pickerTool,
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
            Pick another open project. Each side keeps its own source, filter, analysis window and
            params — the comparison is read-only.
          </Dialog.Description>
          <ul class="compare-targets">
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
          <Show when={compareTargets().length === 0}>
            <p class="compare-dialog-hint">
              No other project is open. Use File → New Window, then compare again.
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
