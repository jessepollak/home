import {
  BOOTSTRAP_COMMAND,
  dependencyProblems,
  describeProblem,
  executedAsScript,
  repositoryRoot,
} from "../worktree/bootstrap.mjs";

import { describeStaleReference, devServerState, staleTypeReferences } from "../worktree/next-types.mjs";

export function preflightProblemLines(root) {
  const problems = dependencyProblems(root);
  if (problems.length === 0) return [];
  return [
    "Home dependencies are not ready in this worktree:",
    ...problems.map((problem) => `  - ${problem.relative} is ${describeProblem(problem)}`),
    `Run \`${BOOTSTRAP_COMMAND}\`, then rerun this command.`,
  ];
}

export function preflightGeneratedTypeLines(root, { devServer } = {}) {
  const stale = staleTypeReferences(root);
  if (stale.length === 0) return [];
  devServer ??= devServerState(root);
  const stopServer = devServer.state === "running" || devServer.state === "unknown";
  return [
    "Home's generated Next type output is stale in this worktree:",
    ...stale.map((entry) => `  - ${describeStaleReference(entry)}`),
    ...(stopServer ? ["Stop the dev server first (apps/web/.next/dev/lock indicates a dev server may be running)."] : []),
    `Run \`${BOOTSTRAP_COMMAND}\`, then rerun this command.`,
  ];
}

if (executedAsScript(import.meta.url)) {
  const root = repositoryRoot();
  const lines = [...preflightProblemLines(root), ...preflightGeneratedTypeLines(root)];
  if (lines.length > 0) {
    for (const line of lines) console.error(line);
    process.exit(1);
  }
}
