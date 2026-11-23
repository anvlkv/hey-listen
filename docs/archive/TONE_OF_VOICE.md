# Tone of voice — proposal

## The frame

**Audio analysis for the era of post-intelligence.** Not "you no longer need to understand sound." Instead: you want to understand it, but your time is scarce. Let an agent do the first pass; use Hey Listen to see the measurements, listen to the moment, question the interpretation, and learn something you can take away.

The agent is an **optional external collaborator via MCP**, not an in-app oracle. Manual exploration and the CLI remain first-class. The app measures; an agent may propose explanations. Never present a model, proxy, or agent inference as a verified fact. [Features](FEATURES.md) tracks what can be claimed today; [the roadmap](roadmap.md) separates future work.

### Writing rules, whatever variant we choose

- **Lead with the question or result.** "Where does the pitch change?" beats "Powerful pitch-analysis capabilities." One idea per sentence; use the shortest useful label.
- **Show the path to knowing.** Pair a claim with its tool, window, units, and caveat when relevant. "The pitch track rises here" is better than "The bird gets excited."
- **Invite a useful next step.** "Listen to this span" or "Compare with the original" beats "Explore our cutting-edge features."
- **Teach in one breath.** Define technical terms in context, then let a chart or About panel carry the detail: "LUFS measures programme loudness; frame RMS catches shorter bursts."
- **Be honest about uncertainty.** Say "likely," "modelled," "proxy," or "not enough voiced audio" when that is what the result supports. An agent's explanation is a hypothesis to inspect, not an analysis result.
- **Use human agency, not AI magic.** "Ask your agent to find candidate calls; check them on the timeline" rather than "AI understands every sound." Avoid "effortless," "instant insights," "revolutionary," and promises of a correct answer.
- **Keep controls literal.** Use the product's terms: **analysis window**, **Filter**, **Synth**, **annotation** (a user-authored mark), **note segment** (a detected musical segment), **project**, **reference**. A comparison is between projects, not two tracks in one window.
- **Respect status.** Examples below use available features unless explicitly marked *future concept*. Templates, live synth, keyboard palette, and contextual onboarding are planned or drafted, not launch copy.

## Three directions

Each direction expresses the same product, from more restrained to more expressive. The samples are alternatives, **not** a request to put all three voices on one screen.

### A. Clear companion — recommended

Warm, brisk, evidence-first. The app helps you ask better questions; an agent helps you get to the interesting part. Good default for UI, docs, and site.

| Surface | Example |
| --- | --- |
| Site headline | **Hear more. Spend less time searching.** |
| Site subhead | Let an agent find the interesting moments. Open the same project to listen, inspect the measurements, and decide what they mean. |
| In-app title | **What changed in this window?** |
| In-app guidance | Start with the waveform. Narrow the window, then open Pitch or Spectrum to test your hunch. |
| Feature description | **Compare projects.** Put the same measurement side by side. See the difference—and when the settings make a difference unreliable. |
| Agent handoff | Ask your agent for a short summary and the time spans behind it. Then listen to those spans. |

**Why choose it:** Fast to scan, doesn't assume prior expertise, and leaves room for uncertainty without sounding defensive.

### B. Field notebook

Observant, curious, precise. Makes the app feel like a place to collect evidence, not generate verdicts. Best for annotations, analysis help, and research-oriented stories; use sparingly for buttons.

| Surface | Example |
| --- | --- |
| Site headline | **Every sound leaves a trace.** |
| Site subhead | Let an agent map the recording. Follow its leads through the waveform, pitch, and spectrum; keep the moments worth returning to. |
| In-app title | **Keep this moment** |
| In-app guidance | Add an annotation here. It can keep the chart values even if you change the analysis settings later. |
| Feature description | **Annotate the evidence.** Mark a moment or span, write what you noticed, and return to the values you saw. |
| Agent handoff | Ask for the strongest candidate. Check the chart, then write down what you hear. |

**Watch out:** Metaphor can obscure controls. Use literal action labels such as **Add annotation**, **Analyze**, and **Save**.

### C. Sharp instruments

Direct, technical, quietly confident. Designed for people working through batches or verifying agent output. Best for CLI documentation and dense analyzer panels, not the whole first-run experience.

| Surface | Example |
| --- | --- |
| Site headline | **Measure the sound. Verify the story.** |
| Site subhead | Run the same analyzers in the app, through an agent, or from the CLI. Keep the settings and evidence with the project. |
| In-app title | **Check the pitch track** |
| In-app guidance | Too few voiced frames for a stable estimate. Widen the window or inspect the waveform. |
| Feature description | **Export with context.** JSON and CSV carry the analysis settings; the chart PNG captures the view you saw. |
| Agent handoff | Request a summary first. Ask for full data only where the result needs a closer look. |

**Watch out:** Precision without orientation can feel like a spec sheet. Pair every specialist term with the user's question.

## Copy patterns to carry across surfaces

- **Site intro (A):** "You don't have to inspect every second. Ask an agent to surface the interesting spans; open Hey Listen to hear them, compare measurements, and keep what you learned." Put the optional agent path next to a direct path: "Or start with a recording and explore yourself."
- **Feature card (A):** "**Filter, then measure.** Shape the sound, hear the change, and run the same analysis on the result." Avoid implying a filter can improve a measurement by itself.
- **In-app empty state (A):** "**Start with a sound.** Open a file, record an input, or render a synth graph." No invented automatic diagnosis.
- **About-panel guidance (A):** "**Pitch estimates a repeating fundamental.** No clear track? Try a different window or check whether this span is voiced." Follow with the analyzer's actual limits, not a generic confidence promise.
- **Comparison caveat (A):** "**No delta for these settings.** The frequency grids differ. Match the analysis settings to compare values." Do not imply the app will interpolate silently.
- **Agent explanation pattern (A):** "**Observation:** the frame-RMS envelope peaks near this span. **Possible reading:** a short call. **Check:** play the span and inspect the note segments." This is a writing pattern for agent responses, **not** a claim that the app generates that prose.
- **Future concept, not current UI (A):** "**Save this setup as a template.** Apply the same tools and settings to another recording." Only use once [templates](templates.md) ships.

**Suggested decision:** Use **Clear companion** as the base voice. Borrow Field notebook's curiosity for annotations and Sharp instruments' restraint for measurements, errors, and CLI output. Keep the headline "Audio analysis for the era of post-intelligence" as positioning or an editorial line, not a claim that understanding can be outsourced.
