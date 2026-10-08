/** A small labeled value used in analyzer readout rows. */
export default function Readout(props: { label: string; value: string; title?: string }) {
  return (
    <span class="readout" title={props.title}>
      <span class="readout-label">{props.label}</span>
      <span class="readout-value">{props.value}</span>
    </span>
  );
}
