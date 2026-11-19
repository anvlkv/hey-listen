import { For, Show, createMemo, createSignal } from "solid-js";
import { nodeKind, type GraphKind, type ParamDef } from "../../lib/graph";
import { graphFor, updateParam } from "../../state/graph";
import { applyPreset, deletePreset, presetsFor, savePreset } from "../../state/graphPresets";
import ParamField from "./ParamField";

/**
 * The docked inspector for the single selected non-anchor node (D-16): the kind's
 * label and hint, every parameter with its range and a per-parameter reset, and the
 * session-scoped presets of the node's kind. `GraphEditor` only mounts it while
 * exactly one such node is selected.
 */
export default function NodeInspector(props: { graph: GraphKind; nodeId: string }) {
  const node = createMemo(() => graphFor(props.graph).nodes.find((n) => n.id === props.nodeId));
  const def = createMemo(() => {
    const current = node();
    return current ? nodeKind(current.data.kind) : undefined;
  });
  const params = () => def()?.params ?? [];
  const valueOf = (param: ParamDef) => node()?.data.params[param.key] ?? param.default;

  const [name, setName] = createSignal("");
  const [chosen, setChosen] = createSignal<string | null>(null);
  const list = createMemo(() => presetsFor(def()?.kind ?? ""));
  const active = createMemo(() => list().find((preset) => preset.id === chosen()) ?? list()[0]);

  const set = (param: ParamDef, value: number) =>
    updateParam(props.graph, props.nodeId, param.key, value);

  function save() {
    const current = node();
    const trimmed = name().trim();
    const kind = def()?.kind;
    if (!current || !kind || !trimmed) return;
    setChosen(savePreset(kind, trimmed, current.data.params).id);
    setName("");
  }

  function apply() {
    const preset = active();
    if (preset) applyPreset(props.graph, props.nodeId, preset);
  }

  function remove() {
    const preset = active();
    if (!preset) return;
    deletePreset(preset.id);
    setChosen(null);
  }

  return (
    <aside class="graph-inspector" data-testid="graph.inspector">
      <div>
        <span class="graph-toolbar-title">{def()?.label ?? "Node"}</span>{" "}
        <span class="graph-status">{def()?.kind}</span>
      </div>
      <Show when={def()?.hint}>
        <div class="graph-status">{def()?.hint}</div>
      </Show>

      <div class="graph-inspector-params">
        <For each={params()}>
          {(param) => (
            <div class="graph-inspector-param" data-testid="graph.inspector-param">
              <ParamField param={param} value={valueOf(param)} onInput={(v) => set(param, v)} />
              <div class="graph-inspector-param-meta">
                <span>
                  {param.min}–{param.max}
                  {param.unit ? ` ${param.unit}` : ""}
                </span>
                <button
                  type="button"
                  class="graph-btn"
                  data-testid="graph.inspector-reset"
                  onClick={() => set(param, param.default)}
                >
                  Reset
                </button>
              </div>
            </div>
          )}
        </For>
      </div>

      <button
        type="button"
        class="graph-btn"
        data-testid="graph.inspector-reset-all"
        onClick={() => params().forEach((param) => set(param, param.default))}
      >
        Reset all
      </button>

      <div class="graph-inspector-presets">
        <span class="graph-toolbar-title">Presets</span>
        <select
          class="graph-number graph-inspector-input"
          aria-label="Preset"
          value={active()?.id ?? ""}
          onChange={(event) => setChosen(event.currentTarget.value || null)}
        >
          <Show when={!list().length}>
            <option value="">No saved presets</option>
          </Show>
          <For each={list()}>{(preset) => <option value={preset.id}>{preset.name}</option>}</For>
        </select>
        <div>
          <button
            type="button"
            class="graph-btn"
            data-testid="graph.preset-apply"
            disabled={!active()}
            onClick={apply}
          >
            Apply
          </button>
          <button
            type="button"
            class="graph-btn"
            data-testid="graph.preset-delete"
            disabled={!active()}
            onClick={remove}
          >
            Delete
          </button>
        </div>
        <input
          class="graph-number graph-inspector-input"
          type="text"
          placeholder="Preset name"
          data-testid="graph.preset-name"
          value={name()}
          onInput={(event) => setName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") save();
          }}
        />
        <button
          type="button"
          class="graph-btn"
          data-testid="graph.preset-save"
          disabled={!name().trim() || !params().length}
          onClick={save}
        >
          Save preset
        </button>
        <div class="graph-status">
          Presets last for this session; they are not saved in the project.
        </div>
      </div>
    </aside>
  );
}
