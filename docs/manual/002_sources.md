# 002 — Open or record a source

A project has exactly one source. Everything you analyze, filter, or annotate belongs to
that source, and changing the source replaces the whole timeline.

![The Source panel](assets/002-source-panel.png)

## Open a file

Use **Open audio file** in the Source panel, drag a file onto the window, or open a
recording straight from your operating system. Hey Listen decodes it and draws it on the
Timeline.

## Where the audio lives

After you pick a file, Hey Listen asks how the project should store it:

- **Embedded** — the samples are written into the project file; the project travels alone.
- **Linked** — the project points at the audio file. Keep the two together (the path is
  stored relative to the project when they sit in the same folder).
- **Live link** — like linked, and the Timeline reloads whenever the file changes, so a
  re-export or a re-render behind the app lands without reopening anything.

The Source panel keeps the choice visible and lets you switch between linked and live
link. A project stored as embedded can only become linked by replacing the source, since
the audio in memory cannot vouch for the file on disk. Your last choice is remembered for
the next file you open. See [Projects](009_projects.md) for what happens when a linked
file goes missing.

## Record a live source

Choose what to capture — a **microphone**, **system** output, a **selected process**, or
a **microphone-and-system mix** — set the input and gain, and monitor before you record.
You can pause and resume, and stop when you are done; what you captured becomes the
project's source.

## Make a sound

Build a synth graph and render it. The rendered audio becomes the source, exactly like a
recording would.

![A rendered synth source on the Timeline](assets/002-synth-source.png)

## Replace the source

Opening or recording a new source replaces the current one. If the project has unsaved
work, Hey Listen asks before discarding it. You cannot keep two sources in one project —
that is what a second project window is for (see [Projects](009_projects.md)).

## When something goes wrong

A file that cannot be decoded shows an error in the Toolbar and leaves the Timeline
empty, rather than opening silence. A capture that fails to start says so in the Source
panel.

Next: [Navigate the timeline](003_timeline.md)
