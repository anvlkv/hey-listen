/* @refresh reload */
// E2E scaffolding (M8): the WebdriverIO Tauri plugin installs `window.wdioTauri`
// and the `invoke` interception the suite's IPC mocks ride on. It is inert in a
// normal run (nothing calls it), so it ships with the app the E2E suite drives.
import "@wdio/tauri-plugin";
import { render } from "solid-js/web";
import { invoke } from "./lib/ipc";
import { attachConsole } from "@tauri-apps/plugin-log";
import App from "./App";
import PopoutApp from "./PopoutApp";

// Forward `console.*` (and therefore any frontend errors) to the Tauri log file,
// alongside the Rust-side logs. Do this before the app renders so early failures
// are captured too.
void attachConsole();

// A popout window renders a single tool; a normal window renders the full app.
void invoke<string | null>("popout_tool").then((tool) => {
  const root = document.getElementById("root") as HTMLElement;
  render(() => (tool ? <PopoutApp toolId={tool} /> : <App />), root);
});
