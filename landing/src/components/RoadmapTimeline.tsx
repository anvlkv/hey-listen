import { createMemo, createSignal, For, onCleanup, onMount } from "solid-js";

import type { Milestone, RoadmapStatus } from "../lib/roadmap";

type Filter = "all" | RoadmapStatus;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "done", label: "Done" },
  { id: "drafted", label: "Drafted" },
  { id: "planned", label: "Planned" },
];

const STATUS_LABEL: Record<RoadmapStatus, string> = {
  done: "Done",
  drafted: "Drafted",
  planned: "Planned",
};

interface Props {
  items: Milestone[];
}

export default function RoadmapTimeline(props: Props) {
  let root: HTMLDivElement | undefined;
  const [filter, setFilter] = createSignal<Filter>("all");

  const counts = createMemo(() => {
    const initial: Record<Filter, number> = {
      all: props.items.length,
      done: 0,
      drafted: 0,
      planned: 0,
    };
    for (const item of props.items) initial[item.status] += 1;
    return initial;
  });

  const visible = createMemo(() =>
    filter() === "all" ? props.items : props.items.filter((item) => item.status === filter()),
  );

  /** Change the filter, then bring the start of the new list back into view. */
  const choose = (next: Filter) => {
    setFilter(next);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.requestAnimationFrame(() => {
      const first = root?.querySelector<HTMLElement>(".milestone") ?? root;
      first?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    });
  };

  onMount(() => {
    if (window.location.hash || window.scrollY > 120) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const target = root?.querySelector<HTMLElement>("[data-roadmap-latest]");
    if (!target) return;

    const timer = window.setTimeout(() => {
      target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    }, 300);
    onCleanup(() => window.clearTimeout(timer));
  });

  return (
    <div class="roadmap" ref={root}>
      <div class="roadmap__filters" role="group" aria-label="Filter milestones">
        <For each={FILTERS}>
          {(item) => (
            <button
              type="button"
              class="roadmap__filter"
              aria-pressed={filter() === item.id}
              onClick={() => choose(item.id)}
            >
              {item.label}
              <span>{counts()[item.id]}</span>
            </button>
          )}
        </For>
        <p class="roadmap__showing" aria-live="polite">
          Showing {visible().length} of {props.items.length}
        </p>
      </div>

      <ol class="roadmap__list">
        <For each={visible()}>
          {(item, index) => (
            <li
              class={`milestone is-${item.status}`}
              id={item.id.toLowerCase().replace(/\./g, "-")}
              data-roadmap-latest={
                filter() === "all" && index() === props.items.length - 1 ? "" : undefined
              }
            >
              <span class="milestone__dot" aria-hidden="true"></span>
              <div class="milestone__content">
                <div class="milestone__head">
                  <span class="milestone__id">{item.id}</span>
                  <h2>{item.title}</h2>
                  <span class="milestone__status">{STATUS_LABEL[item.status]}</span>
                </div>
                {item.description && <p>{item.description}</p>}
              </div>
            </li>
          )}
        </For>
      </ol>
    </div>
  );
}
