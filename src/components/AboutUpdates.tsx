import { Match, Show, Switch } from "solid-js";
import { APP_VERSION } from "../lib/appInfo";
import { checkForUpdates, installUpdate, restartToUpdate, updateState } from "../state/update";

/**
 * The **Updates** section of the About dialog (M33.C).
 *
 * Reached from the Help menu's *Check for Updates…* (which opens the dialog and starts a
 * check) and from the section's own button. A newer build is offered with its release
 * notes; **Download and install** is the only way it installs, and **Restart Now** runs
 * it. See `docs/updater.md`.
 */
export default function AboutUpdates() {
  const state = updateState;
  const percent = () => {
    const { received, total } = state();
    return total && total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
  };
  const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

  return (
    <div class="about-updates" data-testid="about.updates">
      <Switch fallback={<p class="about-text">Updates install only when you ask.</p>}>
        <Match when={state().phase === "checking"}>
          <p class="about-text">Checking for updates…</p>
        </Match>
        <Match when={state().phase === "upToDate"}>
          <p class="about-text">Hey Listen {APP_VERSION} is up to date.</p>
        </Match>
        <Match when={state().phase === "available" ? state().update : null}>
          {(update) => (
            <>
              <p class="about-text">
                Version {update().version} is available (you have {update().currentVersion}).
              </p>
              <Show when={update().notes}>
                {(notes) => <pre class="about-updates-notes">{notes()}</pre>}
              </Show>
            </>
          )}
        </Match>
        <Match when={state().phase === "downloading"}>
          <p class="about-text">
            {state().total != null
              ? `Downloading… ${percent()}%`
              : `Downloading… ${megabytes(state().received)}`}
          </p>
          <Show when={state().total}>
            <div
              class="about-updates-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent()}
            >
              <div class="about-updates-bar" style={{ width: `${percent()}%` }} />
            </div>
          </Show>
        </Match>
        <Match when={state().phase === "ready"}>
          <p class="about-text">The update is installed. Restart Hey Listen to use it.</p>
        </Match>
      </Switch>

      <Show when={state().error}>
        {(error) => (
          <p class="about-text about-updates-error" data-testid="about.updates.error">
            {error()}
          </p>
        )}
      </Show>

      <Show when={state().phase === "available" || state().phase === "ready"}>
        <Show
          when={state().phase === "ready"}
          fallback={
            <button
              type="button"
              class="about-link-button"
              data-testid="about.updates.install"
              onClick={() => void installUpdate()}
            >
              Download and install
            </button>
          }
        >
          <button
            type="button"
            class="about-link-button"
            data-testid="about.updates.restart"
            onClick={() => void restartToUpdate()}
          >
            Restart Now
          </button>
        </Show>
      </Show>
      <Show when={state().phase === "idle" || state().phase === "upToDate"}>
        <button
          type="button"
          class="about-link-button"
          data-testid="about.updates.check"
          onClick={() => void checkForUpdates()}
        >
          Check for Updates…
        </button>
      </Show>
    </div>
  );
}
