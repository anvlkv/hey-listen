import { Dialog } from "@kobalte/core/dialog";
import { onCleanup, Show } from "solid-js";
import { brokenLink, setBrokenLink, type BrokenLinkChoice } from "../../state/sourceStorage";
import Button from "../Button";
import Icon from "../Icon";

/**
 * The missing-link dialog: a project's source file could not be read.
 *
 * Two contexts share it. `"save"` has the audio in memory (it was loaded or opened
 * before the file went away), so it can either locate the file again or embed what it
 * already has. `"open"` is a project that just loaded with an empty timeline — there is
 * nothing to embed, so it offers locate / cancel only; the panel still shows the mode it
 * was saved with.
 */
export default function BrokenLinkDialog() {
  const request = () => brokenLink();
  const open = () => request() != null;
  const saveMode = () => request()?.mode !== "open";

  /** Resolve exactly once: clear the request, then hand the answer back. */
  const finish = (choice: BrokenLinkChoice) => {
    const pending = request();
    if (!pending) return;
    setBrokenLink(null);
    pending.resolve(choice);
  };

  // Unmounted mid-question (the app is closing): the awaiting caller must not hang.
  onCleanup(() => finish("cancel"));

  return (
    <Dialog open={open()} onOpenChange={(next) => !next && finish("cancel")}>
      <Dialog.Portal>
        <Dialog.Overlay class="about-overlay" />
        <Dialog.Content class="about-dialog" data-testid="source.link.missing">
          <header class="about-head">
            <div class="about-identity">
              <Dialog.Title class="about-name">The linked audio is missing</Dialog.Title>
              <div class="about-version">
                {saveMode() ? "Saving this project" : "The project opened without its audio"}
              </div>
            </div>
            <Dialog.CloseButton class="about-close" aria-label="Close">
              <Icon name="xmark" />
            </Dialog.CloseButton>
          </header>

          <Dialog.Description class="about-blurb">
            {saveMode()
              ? "The file this project links to could not be read. Locate it again, or save the audio that is already in memory."
              : "The file this project links to could not be read, so the timeline is empty. Locate it to restore the audio."}
          </Dialog.Description>

          <Show when={request()?.path}>
            {(path) => (
              <p class="source-link-path" title={path()}>
                {path()}
              </p>
            )}
          </Show>

          <div class="source-link-choices">
            <Button
              class="src-button"
              data-testid="source.link.locate"
              onClick={() => finish("locate")}
            >
              Locate file…
            </Button>
            <span class="source-link-hint">Pick the audio again; the project links to it.</span>

            <Show when={saveMode()}>
              <Button
                class="src-button"
                data-testid="source.link.embed"
                onClick={() => finish("embed")}
              >
                Embed this audio
              </Button>
              <span class="source-link-hint">
                Save the samples already in memory inside the project file.
              </span>
            </Show>

            <Button
              class="src-button"
              data-testid="source.link.cancel"
              onClick={() => finish("cancel")}
            >
              Cancel
            </Button>
            <span class="source-link-hint">
              {saveMode() ? "Leave the project unsaved." : "Keep the empty timeline."}
            </span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
