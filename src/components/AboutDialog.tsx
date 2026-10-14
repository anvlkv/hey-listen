import { Dialog } from "@kobalte/core/dialog";
import { For } from "solid-js";
import Icon from "./Icon";
import { invoke } from "../lib/ipc";
import { APP_NAME, APP_TAGLINE, APP_VERSION } from "../lib/appInfo";
import { ATTRIBUTIONS, FONT_AWESOME, type Attribution } from "../lib/attributions";

/**
 * The **About** dialog: app identity plus the required attributions (Font Awesome,
 * and the runtime dependency list). Opened from the Toolbar's `circle-question`
 * button and from the native Help → About menu item.
 *
 * It is a modal Kobalte `Dialog` (ADR-8) rendered by `App`, so it exists in project
 * windows only. License URLs are opened in the system browser by the core
 * (`open_external_url`) — a webview anchor would not leave the app.
 */
export default function AboutDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const openLink = (url: string) => {
    void invoke("open_external_url", { url }).catch((err) =>
      console.error("could not open the link", err),
    );
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay class="about-overlay" />
        <Dialog.Content class="about-dialog" data-testid="about.dialog">
          <header class="about-head">
            <Icon name="font-awesome" class="about-logo" />
            <div class="about-identity">
              <Dialog.Title class="about-name">{APP_NAME}</Dialog.Title>
              <div class="about-version">
                v{APP_VERSION} · {APP_TAGLINE}
              </div>
            </div>
            <Dialog.CloseButton class="about-close" aria-label="Close">
              <Icon name="xmark" />
            </Dialog.CloseButton>
          </header>

          <Dialog.Description class="about-blurb">
            Capture, filter, and analyze audio — from files, live inputs, and synthesis.
            Built on Tauri, SolidJS, and Rust DSP.
          </Dialog.Description>

          <section class="about-section">
            <h3 class="about-heading">{FONT_AWESOME.name}</h3>
            <p class="about-text">{FONT_AWESOME.note}</p>
            <p class="about-text">
              {FONT_AWESOME.license} ·{" "}
              <button type="button" class="about-link" onClick={() => openLink(FONT_AWESOME.url)}>
                {FONT_AWESOME.url}
              </button>
            </p>
          </section>

          <section class="about-section">
            <h3 class="about-heading">Third-party software</h3>
            <p class="about-text">
              With thanks to the many individual contributors behind these projects —
              see <span class="about-mono">ACKNOWLEDGEMENTS.md</span> in the repository.
            </p>
            <ul class="about-list">
              <For each={ATTRIBUTIONS}>
                {(item: Attribution) => (
                  <li class="about-item">
                    <span class="about-dep">{item.name}</span>
                    <span class="about-license">{item.license}</span>
                    <button
                      type="button"
                      class="about-link about-link-sm"
                      title={item.url}
                      onClick={() => openLink(item.url)}
                    >
                      <Icon name="link" /> {item.url.replace(/^https?:\/\//, "")}
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </section>

          <p class="about-foot">
            Full license texts ship with the app (see{" "}
            <span class="about-mono">public/fonts/fontawesome/LICENSE.txt</span> and each
            dependency).
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
