import "./App.css";
import Sidebar from "./components/Sidebar";
import Timeline from "./components/Timeline";
import Toolbar from "./components/Toolbar";
import Workbench from "./components/Workbench";

/**
 * Hey Listen shell.
 *
 * Layout rule: Timeline, Sidebar, and Workbench are FIXED regions (not tabs).
 * The only tabs are analyzer tabs, and they live inside the Workbench — so
 * `dockview` is mounted only there. See `docs/ui-layout.md`.
 */
export default function App() {
  return (
    <div class="app-shell">
      <Toolbar />
      <div class="app-main">
        <Sidebar />
        <div class="app-center">
          <Workbench />
          <Timeline />
        </div>
      </div>
    </div>
  );
}
