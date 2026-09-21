// Repository location helpers.
//
// The scripts in this skill run from the Home worktree root, but resolving the
// root from the script's own path keeps them usable from any working directory.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The skill lives at <root>/.agents/skills/figma-implementation/scripts/lib/repo.mjs */
const SKILL_LIB_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Walk up from `start` until a directory containing both the workspace root
 * `package.json` and `apps/web/package.json` is found.
 *
 * @param {string} [start]
 */
export function resolveRepoRoot(start = SKILL_LIB_DIR) {
  let dir = start;
  for (;;) {
    if (
      existsSync(join(dir, "package.json")) &&
      existsSync(join(dir, "apps", "web", "package.json"))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Could not locate the Home repo root (a directory with package.json and apps/web/package.json) above ${start}.`,
      );
    }
    dir = parent;
  }
}
