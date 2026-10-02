// Every rule case in this directory runs through a freshly spawned Oxlint
// process, which can take seconds on a loaded machine; Bun's 5 s per-test
// default then kills cases that pass in isolation. Bun resets the default for
// each test file and caches this module across files in one process, so an
// import alone is not enough: call this at module scope in every rule-check file
// that spawns a linter.
import { setDefaultTimeout } from "bun:test";

export function applyRuleCheckTimeout() {
  setDefaultTimeout(20_000);
}
