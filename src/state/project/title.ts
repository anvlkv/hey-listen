import { createEffect, createMemo, createRoot } from "solid-js";
import { isPopoutWindow } from "../../lib/windowRole";
import { setWindowTitle } from "../source";
import { projectName } from "./signals";

// Keep the native window title in sync with the project name — its `*` marks unsaved
// edits (`setWindowTitle` lives in `state/source.ts`). The memo dedupes so a source's
// per-frame updates don't re-set the title. A popout window owns its own title
// (`<tool> — <project>`, see `PopoutApp.tsx`).
createRoot(() => {
  if (isPopoutWindow) return;
  const title = createMemo(() => projectName());
  createEffect(() => void setWindowTitle(title()));
});
