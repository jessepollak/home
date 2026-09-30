import {
  BOOTSTRAP_COMMAND,
  dependencyProblems,
  describeProblem,
  executedAsScript,
  repositoryRoot,
} from "../worktree/bootstrap.mjs";

export function preflightProblemLines(root) {
  const problems = dependencyProblems(root);
  if (problems.length === 0) return [];
  return [
    "Home dependencies are not ready in this worktree:",
    ...problems.map((problem) => `  - ${problem.relative} is ${describeProblem(problem)}`),
    `Run \`${BOOTSTRAP_COMMAND}\`, then rerun this command.`,
  ];
}

if (executedAsScript(import.meta.url)) {
  const lines = preflightProblemLines(repositoryRoot());
  if (lines.length > 0) {
    for (const line of lines) console.error(line);
    process.exit(1);
  }
}
