import { config } from "@remotion/eslint-config-flat";
import globals from "globals";

export default [
  // `.agents/skills/**` is a vendored copy of the agent-skill bundle, not this
  // project's source. The repo's root `eslint .` walks into it as well, so keep it
  // out of the lint scope (the bundled samples are not ours to fix).
  { ignores: ["**/.agents/**"] },
  ...config,
  // The build scripts run in Node, not the browser: the Remotion config declares
  // no environment globals, so `console`/`process` would read as undefined.
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { ...globals.node } },
  },
];
