import { Dialog } from "@kobalte/core/dialog";
import { createEffect, createSignal, on, onCleanup, Show } from "solid-js";
import type { SourceStorage } from "../../bindings/SourceStorage";
import {
  rememberedStorage,
  rememberStorage,
  setStorageChooser,
  storageChooser,
} from "../../state/sourceStorage";
import Button from "../Button";
import Icon from "../Icon";
import StorageCards from "./StorageCards";

/**
 * The post-pick chooser: after the user picks an audio file, how should the project
 * store it? Resolves the `askStorage` promise the open path awaits — a mode, or `null`
 * when the pick is cancelled (the file is not opened at all).
 *
 * Defaults to the mode picked last time, and confirming **remembers** it, so a repeat
 * user opens files in one click once the default matches what they want.
 */
export default function StorageDialog() {
  const request = () => storageChooser();
  const open = () => request() != null;
  const [picked, setPicked] = createSignal<SourceStorage>(rememberedStorage());

  // Each pick starts from the remembered default, never from the previous pick.
  createEffect(
    on(open, (isOpen) => {
      if (!isOpen) return;
      setPicked(rememberedStorage());
    }),
  );

  /** Resolve exactly once: clear the request, then hand the answer back. */
  const finish = (mode: SourceStorage | null) => {
    const pending = request();
    if (!pending) return;
    setStorageChooser(null);
    pending.resolve(mode);
  };

  const confirm = () => {
    const mode = picked();
    rememberStorage(mode);
    finish(mode);
  };

  // Unmounted mid-question (the app is closing): the awaiting open must not hang.
  onCleanup(() => finish(null));

  return (
    <Dialog open={open()} onOpenChange={(next) => !next && finish(null)}>
      <Dialog.Portal>
        <Dialog.Overlay class="about-overlay" />
        <Dialog.Content class="about-dialog" data-testid="storage.dialog">
          <header class="about-head">
            <div class="about-identity">
              <Dialog.Title class="about-name">Store this audio</Dialog.Title>
              <div class="about-version">Choose how the project keeps its samples</div>
            </div>
            <Dialog.CloseButton class="about-close" aria-label="Close">
              <Icon name="xmark" />
            </Dialog.CloseButton>
          </header>

          <Show when={request()?.path}>
            {(path) => (
              <p class="source-link-path" title={path()}>
                {path()}
              </p>
            )}
          </Show>

          <StorageCards value={picked()} onChange={setPicked} testIdPrefix="storage.dialog.mode" />

          <div class="storage-dialog-actions">
            <Button
              class="src-button"
              data-testid="storage.dialog.cancel"
              onClick={() => finish(null)}
            >
              Cancel
            </Button>
            <Button
              class="src-button storage-dialog-primary"
              data-testid="storage.dialog.open"
              onClick={confirm}
            >
              Open
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
