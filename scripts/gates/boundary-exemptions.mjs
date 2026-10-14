import path from "node:path";
import { pathToFileURL } from "node:url";
import { evaluateBoundaryExemptions, readBoundaryBase, readBoundaryInput } from "./exploration-boundary.mjs";

export function checkBoundaryExemptions(baseRef) {
  const { base, directories, exemptions, rootFiles } = { ...readBoundaryInput(), base: readBoundaryBase(baseRef) };
  const result = evaluateBoundaryExemptions({ directories, rootFiles, exemptions, base });
  const notes = result.dormant.map((entry) => `${entry}: exemption covers no source file; remove the entry from scripts/gates/exploration-boundary-exemptions.json`);
  const failures = [
    ...result.stale.map((entry) => `${entry}: stale exploration boundary exemption; remove it`),
    ...result.reactivated.map((entry) => `${entry}: exemption covered no source at the base revision and now covers one again; edit its reason so a reviewer renews it, or remove it and fence the directory`),
    ...result.invalid.map((entry) => `${entry || "(missing path)"}: invalid exploration boundary exemption`),
  ];
  return { notes, failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { notes, failures } = checkBoundaryExemptions(process.env.BASE_REF || "main");
    for (const note of notes) console.log(note);
    for (const failure of failures) console.error(failure);
    if (failures.length) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
