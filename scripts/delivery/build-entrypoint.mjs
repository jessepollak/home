// Build entrypoint contract: the Vercel-facing app build must apply database
// migrations before `next build`, joined by a single successful `&&` in that
// order — no `;` chains and no `||` fallbacks that could build (or claim
// success) after a failed migration — and the root build must delegate to
// apps/web so nothing attaches migrations (or a second build) to the root only.

const ROOT_BUILD_DELEGATION = /^bun run --cwd apps\/web build$/;
const MIGRATION_PATTERN = /db:migrate/;
const NEXT_BUILD_PATTERN = /next build/;
// Harmless whitespace around the join is allowed; anything else (`;`, `||`,
// extra segments) breaks the contract.
const APP_BUILD_JOIN = /\s*&&\s*/;

// rootBuild/appBuild: the "build" script values from the root and apps/web manifests.
// Returns sorted, human-readable contract errors; empty means the contract holds.
export function evaluateBuildEntrypoints({ rootBuild, appBuild }) {
  const errors = [];
  const root = (rootBuild ?? "").trim();
  const app = (appBuild ?? "").trim();

  if (!ROOT_BUILD_DELEGATION.test(root)) {
    errors.push(
      `root build must delegate to apps/web ("bun run --cwd apps/web build"); found: "${root}"`,
    );
  }

  if (app.includes(";")) {
    errors.push(`apps/web build must not chain commands with ";"; found: "${app}"`);
  }
  if (app.includes("||")) {
    errors.push(`apps/web build must not mask a failed migration with "||"; found: "${app}"`);
  }

  const steps = app.split(APP_BUILD_JOIN);
  const migrationAt = steps.findIndex((step) => MIGRATION_PATTERN.test(step));
  const nextBuildAt = steps.findIndex((step) => NEXT_BUILD_PATTERN.test(step));
  if (migrationAt !== -1 && nextBuildAt !== -1 && migrationAt > nextBuildAt) {
    errors.push(
      `apps/web build must run db:migrate before next build, not after; found: "${app}"`,
    );
  } else if (steps.length !== 2 || migrationAt !== 0 || nextBuildAt !== 1) {
    errors.push(
      `apps/web build must run db:migrate before next build, joined by &&; found: "${app}"`,
    );
  }

  return errors.sort();
}
