// Build entrypoint contract: the Vercel-facing app build must apply database
// migrations before `next build`, and the root build must delegate to apps/web
// so nothing attaches migrations (or a second build) to the root only.

const ROOT_BUILD_DELEGATION = /^bun run --cwd apps\/web build$/;
const MIGRATION_PATTERN = /db:migrate/;
const NEXT_BUILD_PATTERN = /next build/;

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

  const migrationAt = app.search(MIGRATION_PATTERN);
  const nextBuildAt = app.search(NEXT_BUILD_PATTERN);
  if (migrationAt === -1 || nextBuildAt === -1) {
    errors.push(
      `apps/web build must run db:migrate before next build; found: "${app}"`,
    );
  } else if (migrationAt > nextBuildAt) {
    errors.push(
      `apps/web build must run db:migrate before next build, not after; found: "${app}"`,
    );
  }

  return errors.sort();
}
