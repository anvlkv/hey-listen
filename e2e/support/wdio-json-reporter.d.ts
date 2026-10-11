/**
 * Minimal type shim for the `@wdio/json-reporter` merge helper, which the package
 * exposes via its `exports` map without a `types` condition. Used by `wdio.conf.ts`
 * to merge the per-spec JSON reports into one file.
 */
declare module "@wdio/json-reporter/mergeResults" {
  export default function mergeResults(
    dir?: string,
    filePattern?: string | RegExp,
    customFileName?: string,
  ): Promise<unknown>;
}
