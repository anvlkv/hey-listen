import { onMount } from "solid-js";
import { useSolidFlow } from "@dschz/solid-flow";

/** The `solid-flow` instance API, as read from inside the flow's context. */
export type FlowApi = ReturnType<typeof useSolidFlow>;

/**
 * Captures the flow instance from *inside* `<SolidFlow>` (the only place the flow
 * context exists) and hands it to the editor body. Needed for `screenToFlowPosition`
 * and handle geometry in the drop-to-insert gesture. Renders nothing.
 */
export function FlowBridge(props: { ready: (api: FlowApi) => void }) {
  const api = useSolidFlow();
  onMount(() => props.ready(api));
  return null;
}
