import { createSignal, onCleanup } from "solid-js";

interface Props {
  text: string;
  label?: string;
}

export default function CopyButton(props: Props) {
  const [copied, setCopied] = createSignal(false);
  let timer: number | undefined;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.text);
      setCopied(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be denied; the text stays selectable in the block.
    }
  };

  onCleanup(() => {
    if (typeof window !== "undefined") window.clearTimeout(timer);
  });

  return (
    <button type="button" class="copy-button" onClick={copy} aria-live="polite">
      {copied() ? "Copied" : (props.label ?? "Copy")}
    </button>
  );
}
