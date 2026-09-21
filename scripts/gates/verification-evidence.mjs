import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function parseSurfaceOwnership(markdown) {
  const surfaces = [];
  for (const section of markdown.split(/^###\s+/m).slice(1)) {
    const [heading = "", ...lines] = section.split("\n");
    const id = heading.match(/^`([^`]+)`/)?.[1];
    if (!id) continue;
    const body = lines.join("\n");
    const live = body.match(/^- \*\*Live\*\*:\s*(read-only|up-to-review|confirm)$/m)?.[1] ?? "read-only";
    const owned = body.match(/^- \*\*Owned paths\*\*:\s*(.*)$/m)?.[1] ?? "";
    const ownedPaths = [...owned.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    surfaces.push({ id, live, ownedPaths });
  }
  return surfaces;
}

function globPattern(glob) {
  let source = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === "*" && glob[index + 1] === "*") {
      source += ".*";
      index += 1;
    } else if (character === "*") {
      source += "[^/]*";
    } else {
      source += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`${source}$`);
}

export function pathMatchesGlob(path, glob) {
  return globPattern(glob).test(path);
}

const rungThreePaths = [
  "apps/web/server/actions/**",
  "apps/web/server/money-actions/**",
  "apps/web/app/api/actions/**",
  "apps/web/client/money-modal/**",
  "**/*calldata*",
  "apps/web/client/transfers/send-dialog.tsx",
  "apps/web/client/savings/savings-actions.tsx",
  "apps/web/client/borrowing/borrowing-experience.tsx",
];

export function requiredRung(surface, path) {
  if (surface.live === "read-only") return 1;
  if (surface.live === "confirm" && rungThreePaths.some((glob) => pathMatchesGlob(path, glob))) return 3;
  return 2;
}

export function parseVerificationRows(body) {
  const heading = /^## Verification\s*$/m.exec(body);
  const section = heading ? body.slice(heading.index + heading[0].length).split(/^##\s/m)[0] : "";
  const rows = new Map();
  for (const line of section.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 4) continue;
    const surface = cells[0].match(/[^\s`]+/)?.[0];
    if (!surface || /^surface$/i.test(surface) || /^-+$/.test(surface)) continue;
    const rung = Number(cells[1].match(/(?:^|\s)([0-4])(?=\s|$)/)?.[1] ?? Number.NaN);
    rows.set(surface, { rung, evidence: cells[2], incidents: cells[3] });
  }
  return rows;
}

export function verificationEvidenceFindings(files, body, surfaces) {
  const rows = parseVerificationRows(body);
  const required = new Map();
  for (const path of files) {
    for (const surface of surfaces) {
      if (!surface.ownedPaths.some((glob) => pathMatchesGlob(path, glob))) continue;
      required.set(surface.id, Math.max(required.get(surface.id) ?? 0, requiredRung(surface, path)));
    }
  }
  const findings = [];
  for (const [surface, rung] of required) {
    const row = rows.get(surface);
    if (!row) findings.push(`Missing ## Verification row for ${surface}; Rung ${rung} is required.`);
    else if (!Number.isFinite(row.rung)) findings.push(`Missing rung for ${surface}; Rung ${rung} is required.`);
    else if (row.rung < rung) findings.push(`${surface} reports Rung ${row.rung}; Rung ${rung} is required.`);
    else if (!row.evidence || /^(n\/a|none|-|pending)$/i.test(row.evidence)) findings.push(`${surface} needs an evidence pointer for Rung ${rung}.`);
  }
  return findings;
}

function changedFiles(base) {
  return execFileSync("git", ["diff", "--name-only", `origin/${base}..HEAD`], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function main() {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const featureMap = readFileSync(`${root}/.agents/skills/browser-iteration/feature-map.md`, "utf8");
  const base = process.env.BASE_REF || "main";
  const body = process.env.PR_BODY || "";
  const findings = verificationEvidenceFindings(changedFiles(base), body, parseSurfaceOwnership(featureMap));
  if (findings.length === 0) {
    console.log("Verification evidence gate passed.");
    return;
  }
  for (const finding of findings) console.error(finding);
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
