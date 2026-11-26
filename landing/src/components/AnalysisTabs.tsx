import { createSignal, For } from "solid-js";

export interface AnalysisTab {
  id: string;
  label: string;
  /** The activity bar's icon for the section, as inline SVG markup. */
  icon: string;
  title: string;
  blurb: string;
  caveat?: string;
  image: string;
  alt: string;
}

interface Props {
  tabs: AnalysisTab[];
}

/** The analyzer sections, as a keyboard-operable tab set with the activity bar's icons. */
export default function AnalysisTabs(props: Props) {
  const [active, setActive] = createSignal(0);

  const move = (event: KeyboardEvent, index: number) => {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();

    const last = props.tabs.length - 1;
    let next = index;
    if (event.key === "ArrowRight") next = index === last ? 0 : index + 1;
    if (event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = last;

    setActive(next);
    const buttons =
      event.currentTarget instanceof HTMLElement
        ? event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
        : undefined;
    buttons?.[next]?.focus();
  };

  return (
    <div class="analysis">
      <div class="analysis__tablist" role="tablist" aria-label="Analysis sections">
        <For each={props.tabs}>
          {(tab, index) => (
            <button
              type="button"
              role="tab"
              id={`analysis-tab-${tab.id}`}
              class="analysis__tab"
              aria-controls={`analysis-panel-${tab.id}`}
              aria-selected={active() === index()}
              tabIndex={active() === index() ? 0 : -1}
              onClick={() => setActive(index())}
              onKeyDown={(event) => move(event, index())}
            >
              <span class="analysis__tab-icon" aria-hidden="true" innerHTML={tab.icon} />
              <span>{tab.label}</span>
            </button>
          )}
        </For>
      </div>

      <For each={props.tabs}>
        {(tab, index) => (
          <section
            class="analysis__panel"
            role="tabpanel"
            id={`analysis-panel-${tab.id}`}
            aria-labelledby={`analysis-tab-${tab.id}`}
            hidden={active() !== index()}
          >
            <div class="analysis__copy">
              <h3>{tab.title}</h3>
              <p>{tab.blurb}</p>
              {tab.caveat && <p class="analysis__caveat">{tab.caveat}</p>}
            </div>
            <figure class="analysis__figure">
              <img src={tab.image} alt={tab.alt} loading="lazy" decoding="async" />
            </figure>
          </section>
        )}
      </For>
    </div>
  );
}
