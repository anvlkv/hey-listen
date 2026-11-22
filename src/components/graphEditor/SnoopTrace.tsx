import { createSignal, onCleanup, onMount } from "solid-js";
import { invoke } from "../../lib/ipc";

/** What `graph_snoop` returns (Rust `SnoopView`). */
interface SnoopView {
  capacity: number;
  total: number;
  samples: number[];
}

const POINTS = 48;
const POLL_MS = 250;
const WIDTH = 84;
const HEIGHT = 22;

/**
 * A `snoop` node's compact waveform: the latest samples fundsp's `SnoopBackend`
 * shipped while the net ran (preview/analysis for a filter, a render for a synth).
 *
 * The node polls the core (`graph_snoop`) while mounted; nothing runs when no snoop
 * node is on screen. Values are absolute peaks, drawn as a symmetric envelope.
 */
export default function SnoopTrace(props: { scope: string; node: string }) {
  const [samples, setSamples] = createSignal<number[]>([]);
  let timer: number | undefined;

  onMount(() => {
    const poll = async () => {
      try {
        const view = await invoke<SnoopView>("graph_snoop", {
          scope: props.scope,
          node: props.node,
          points: POINTS,
        });
        if (view.total > 0) setSamples(view.samples);
      } catch {
        // The core is between graphs, or the node was just deleted: keep the last trace.
      }
    };
    void poll();
    timer = window.setInterval(() => void poll(), POLL_MS);
  });
  onCleanup(() => {
    if (timer != null) window.clearInterval(timer);
  });

  const mid = HEIGHT / 2;
  /** Top edge left → right, then bottom edge right → left: a filled envelope. */
  const envelope = () => {
    const values = samples();
    if (values.length === 0) return "";
    const step = WIDTH / Math.max(values.length - 1, 1);
    const top = values.map((value, index) => {
      const y = mid - Math.max(value, 0.02) * (mid - 1);
      return `${(index * step).toFixed(2)},${y.toFixed(2)}`;
    });
    const bottom = values
      .map((value, index) => {
        const y = mid + Math.max(value, 0.02) * (mid - 1);
        return `${(index * step).toFixed(2)},${y.toFixed(2)}`;
      })
      .reverse();
    return [...top, ...bottom].join(" ");
  };

  return (
    <svg
      class="graph-snoop"
      data-testid="graph.snoop"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label="Snooped waveform"
    >
      <line class="graph-snoop-axis" x1="0" y1={mid} x2={WIDTH} y2={mid} />
      <polygon class="graph-snoop-fill" points={envelope()} />
    </svg>
  );
}
