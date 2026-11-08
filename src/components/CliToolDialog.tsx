import { Dialog } from "@kobalte/core/dialog";
import { createEffect, createSignal, Show } from "solid-js";
import type { CliToolStatus } from "../bindings/CliToolStatus";
import Icon from "./Icon";
import { invoke, errorMessage } from "../lib/ipc";

/** The installed command's name, as `docs/updater.md` documents it. */
const CLI_NAME = "hey-listen-cli";

/**
 * The **Command Line Tool** dialog (M33.D, ADR-31).
 *
 * Reached from *Help → Install Command Line Tool…* (`installCliTool` on `app:menu`).
 * It reports the core's `cli_tool_status` (path, `PATH` membership, recorded vs
 * current version, staleness) and offers the matching action: **Install** when
 * absent, **Update** when stale, **Repair** otherwise, plus **Uninstall** when
 * installed. Every action calls the core, which stages the copy before swapping it
 * in — so a failure leaves an existing install untouched and is reported as an
 * error here. See `docs/updater.md`.
 */
export default function CliToolDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [status, setStatus] = createSignal<CliToolStatus | null>(null);
  const [busy, setBusy] = createSignal<"install" | "uninstall" | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  async function refresh(): Promise<void> {
    try {
      setStatus(await invoke<CliToolStatus>("cli_tool_status"));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  createEffect(() => {
    if (!props.open) return;
    setNotice(null);
    setError(null);
    void refresh();
  });

  /** What the main action does, given the installed copy's state. */
  const installLabel = () => {
    const current = status();
    if (!current?.installed) return "Install";
    return current.stale ? "Update" : "Repair";
  };

  async function install(): Promise<void> {
    setBusy("install");
    setNotice(null);
    setError(null);
    try {
      const path = await invoke<string>("cli_tool_install");
      setNotice(`Installed to ${path}.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      await refresh();
      setBusy(null);
    }
  }

  async function uninstall(): Promise<void> {
    setBusy("uninstall");
    setNotice(null);
    setError(null);
    try {
      const removed = await invoke<boolean>("cli_tool_uninstall");
      setNotice(removed ? "The command line tool was removed." : "Nothing was installed.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      await refresh();
      setBusy(null);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay class="about-overlay" />
        <Dialog.Content class="about-dialog" data-testid="cli.dialog">
          <header class="about-head">
            <div class="about-identity">
              <Dialog.Title class="about-name">Command Line Tool</Dialog.Title>
              <div class="about-version">Install {CLI_NAME} for scripts and CI</div>
            </div>
            <Dialog.CloseButton class="about-close" aria-label="Close">
              <Icon name="xmark" />
            </Dialog.CloseButton>
          </header>

          <Dialog.Description class="about-blurb">
            Copies the command line tool bundled with this app to your user bin folder. It stays in
            step with the app, so updating Hey Listen updates it too.
          </Dialog.Description>

          <section class="about-section">
            <h3 class="about-heading">Status</h3>
            <Show
              when={status()}
              fallback={<p class="about-text">{error() ?? "Reading the install state…"}</p>}
            >
              {(current) => (
                <div class="cli-tool-status">
                  <p class="about-text">
                    <Show when={current().installed} fallback="Not installed. It installs to:">
                      Installed at:
                    </Show>{" "}
                    <span class="about-mono" data-testid="cli.path">
                      {current().path}
                    </span>
                  </p>
                  <p class="about-text">
                    App version <span class="about-mono">{current().currentVersion}</span>
                    <Show when={current().installed}>
                      {" · "}
                      <Show when={current().recordedVersion} fallback="no recorded version">
                        {(version) => (
                          <>
                            installed from <span class="about-mono">{version()}</span>
                          </>
                        )}
                      </Show>
                    </Show>
                  </p>
                  <Show when={current().stale}>
                    <p class="about-text cli-tool-warning" data-testid="cli.stale">
                      The installed copy does not match this app. Update it to install the bundled{" "}
                      {current().currentVersion}.
                    </p>
                  </Show>
                  <p class="about-text" data-testid="cli.onPath">
                    <Show
                      when={current().onPath}
                      fallback={
                        <>
                          The install folder is not on your PATH — add it, or run{" "}
                          <span class="about-mono">{CLI_NAME}</span> by its full path.
                        </>
                      }
                    >
                      The install folder is on your PATH — run{" "}
                      <span class="about-mono">{CLI_NAME}</span> from a terminal.
                    </Show>
                  </p>

                  <div class="cli-tool-actions">
                    <button
                      type="button"
                      class="about-link-button"
                      data-testid="cli.install"
                      disabled={busy() != null}
                      onClick={() => void install()}
                    >
                      {busy() === "install" ? "Installing…" : installLabel()}
                    </button>
                    <Show when={current().installed}>
                      <button
                        type="button"
                        class="about-link-button"
                        data-testid="cli.uninstall"
                        disabled={busy() != null}
                        onClick={() => void uninstall()}
                      >
                        {busy() === "uninstall" ? "Removing…" : "Uninstall"}
                      </button>
                    </Show>
                  </div>

                  <Show when={notice()}>
                    {(text) => (
                      <p class="about-text" data-testid="cli.message">
                        {text()}
                      </p>
                    )}
                  </Show>
                  <Show when={error()}>
                    {(text) => (
                      <p class="about-text about-updates-error" data-testid="cli.error">
                        {text()}
                      </p>
                    )}
                  </Show>
                </div>
              )}
            </Show>
          </section>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
