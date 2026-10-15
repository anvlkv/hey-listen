import type { NodeKindDef } from "../types";
import { CONTROL } from "./control";
import { DYNAMICS } from "./dynamics";
import { FILTERS } from "./filters";
import { FILTERS_CV } from "./filtersCv";
import { GENERATORS } from "./generators";
import { MATH } from "./math";
import { MODULATION } from "./modulation";
import { REVERB } from "./reverb";
import { ROUTING } from "./routing";

/** Every node kind the editor can place, in palette order. */
export const NODE_KINDS: NodeKindDef[] = [
  ...ROUTING,
  ...MATH,
  ...FILTERS,
  ...FILTERS_CV,
  ...DYNAMICS,
  ...MODULATION,
  ...REVERB,
  ...CONTROL,
  ...GENERATORS,
];
