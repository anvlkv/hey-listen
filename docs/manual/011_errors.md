# 011 — When something goes wrong

Hey Listen tells you what failed and keeps you working. Errors appear where the problem
is, not in a hidden log.

![A toolbar error](assets/011-errors.png)

## Messages you may see

- **A file will not open.** A corrupt or unsupported file shows a Toolbar error and
  leaves the Timeline empty. Nothing is half-loaded.
- **An analysis fails.** The analyzer tab stays open and shows the error, so you can
  adjust the window or options and try again without reopening anything.
- **A graph is rejected.** The graph editor shows what was wrong; the previous graph and
  the applied/bypassed state are kept. Fix the graph and it compiles again.
- **A render fails.** The graph editor reports it and the **Render** button becomes
  available again, so the failure does not trap you.
- **Output is not connected.** If your output device disappears, a banner stays up until
  a device is available again.
- **Preview will not start.** The Toolbar reports it, and retrying clears the message once
  playback works.

## Checking the log

Frontend and engine errors are also written to the app log. The **Help** menu can open the
log location or show a preview of it, so you can see what the app was doing when a problem
happened.

## Getting back to a known state

If an edit went wrong, undo it. If a whole session went wrong, save early and often — a
`.heyl` file holds everything, and reopening it is a clean, repeatable starting point.

Back to [the manual index](README.md)
