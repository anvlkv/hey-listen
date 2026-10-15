import SelectTrigger from "../SelectTrigger";
import { choice, recording, setChoice, setDeviceId, setTargetPid } from "../../state/capture";
import { SOURCE_CHOICES } from "./kinds";

/** The source-kind picker, shared by the hero and the replace controls. */
export default function SourceKindSelect() {
  return (
    <SelectTrigger
      value={SOURCE_CHOICES.find((item) => item.value === choice())}
      onChange={(value) => {
        setChoice(value);
        // Selections are per-kind: a mic device id is not valid for system, etc.
        setDeviceId(null);
        setTargetPid(null);
      }}
      options={SOURCE_CHOICES}
      placeholder="Audio file"
      testId="source.kind"
      disabled={recording()}
    />
  );
}
