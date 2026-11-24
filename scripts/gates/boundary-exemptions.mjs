import path from "node:path";
import { pathToFileURL } from "node:url";
import { boundaryGit, evaluateBoundaryExemptions, readBoundaryBase, readBoundaryInput } from "./exploration-boundary.mjs";

export function checkBoundaryExemptions(baseRef, { root, env } = {}) {
  const gitRunner = root || env ? boundaryGit(root, env) : undefined;
  const { base, directories, exemptions, rootFiles } = { ...readBoundaryInput({ root, gitRunner }), base: readBoundaryBase(baseRef, gitRunner) };
  const result = evaluateBoundaryExemptions({ directories, rootFiles, exemptions, base });
  const notes = result.dormant.map((entry) => `${entry}: exemption covers no source file; remove the entry from scripts/gates/exploration-boundary-exemptions.json`);
  const failures = [
    ...result.stale.map((entry) => `${entry}: stale exploration boundary exemption; remove it`),
    ...result.reactivated.map((entry) => `${entry}: exemption covered no source at the base revision and now covers one again; edit its reason so a reviewer renews it, or remove it and fence the directory`),
    ...result.invalid.map((entry) => `${entry || "(missing path)"}: invalid exploration boundary exemption`),
  ];
  return { notes, failures };
}

export function runBoundaryExemptions({ cwd, env = process.env } = {}) {
  const lines = (values) => values.map((value) => `${value}\n`).join("");
  try {
    const { notes, failures } = checkBoundaryExemptions(env.BASE_REF || "main", cwd ? { root: cwd, env } : {});
    return { status: failures.length ? 1 : 0, stdout: lines(notes), stderr: lines(failures) };
  } catch (error) {
    return { status: 1, stdout: "", stderr: lines([error.message]) };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = runBoundaryExemptions();
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.status;
}
