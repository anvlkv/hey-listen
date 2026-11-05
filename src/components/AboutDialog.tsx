import { Dialog } from "@kobalte/core/dialog";
import Icon from "./Icon";
import { invoke } from "../lib/ipc";
import { APP_NAME, APP_TAGLINE, APP_VERSION } from "../lib/appInfo";
import { FONT_AWESOME } from "../lib/attributions";

/**
 * The **About** dialog: app identity plus the required Font Awesome attribution,
 * linking to `ACKNOWLEDGEMENTS.md` for the full dependency contributor list. Opened
 * from the Toolbar's `circle-question` button and from the native Help → About menu
 * item.
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
            Capture, filter, and analyze audio — from files, live inputs, and synthesis. Built on
            Tauri, SolidJS, and Rust DSP.
          </Dialog.Description>

          <section class="about-section">
            <h3 class="about-heading">{FONT_AWESOME.name}</h3>
            <p class="about-text">{FONT_AWESOME.annotation}</p>
            <p class="about-text">
              {FONT_AWESOME.license} ·{" "}
              <button type="button" class="about-link" onClick={() => openLink(FONT_AWESOME.url)}>
                {FONT_AWESOME.url}
              </button>
            </p>
          </section>

          <section class="about-section">
            <p class="about-text">
              Built on Tauri, SolidJS and Rust, with thanks to every open-source maintainer listed
              in <span class="about-mono">ACKNOWLEDGEMENTS.md</span>.
            </p>
            <button
              type="button"
              class="about-link about-link-button"
              onClick={() =>
                openLink("https://github.com/anvlkv/hey-listen/blob/main/ACKNOWLEDGEMENTS.md")
              }
            >
              View acknowledgements
            </button>
          </section>

          <p class="about-foot">
            Font Awesome license:{" "}
            <span class="about-mono">public/fonts/fontawesome/LICENSE.txt</span> · full
            acknowledgements in the repository.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
