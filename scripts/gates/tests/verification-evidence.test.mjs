import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseSurfaceOwnership,
  readSurfaceOwnership,
  parseVerificationRows,
  pathMatchesGlob,
  requiredRung,
  verificationEvidenceFindings,
} from "../verification-evidence.mjs";

const featureMap = `### \`landing\`
- **Live**: read-only
- **Owned paths**: \`apps/web/client/landing/**\`

### \`send\`
- **Live**: confirm
- **Owned paths**: \`apps/web/client/transfers/**\`, \`apps/web/server/actions/**\`
`;
const surfaces = parseSurfaceOwnership(featureMap);
const body = `## Verification

| surface | rung reached | evidence pointer | incidents |
| --- | --- | --- | --- |
| landing | 1 | /tmp/landing/summary.md | none |
| send | 3 | /tmp/send/summary.md | none |

Verified: landing rung 1
Verified: send rung 3

## Preview
N/A
`;

test("parses owned paths and verification rows", () => {
  assert.deepEqual(surfaces, [
    { id: "landing", live: "read-only", ownedPaths: ["apps/web/client/landing/**"] },
    { id: "send", live: "confirm", ownedPaths: ["apps/web/client/transfers/**", "apps/web/server/actions/**"] },
  ]);
  assert.equal(parseVerificationRows(body).get("send").rung, 3);
  assert.equal(pathMatchesGlob("apps/web/client/landing/page.tsx", "apps/web/client/landing/**"), true);
  assert.equal(pathMatchesGlob("apps/web/client/home/page.tsx", "apps/web/client/landing/**"), false);
});

test("reads surface ownership from individual files and rejects mismatched names", () => {
  const directory = mkdtempSync(join(tmpdir(), "home-surface-"));
  try {
    writeFileSync(join(directory, "send.md"), featureMap.split("\n\n")[1]);
    writeFileSync(join(directory, "landing.md"), featureMap.split("\n\n")[0]);
    assert.deepEqual(readSurfaceOwnership(directory), surfaces);
    writeFileSync(join(directory, "wrong.md"), "### `landing`\n- **Owned paths**: `apps/web/app/page.tsx`\n");
    assert.throws(() => readSurfaceOwnership(directory), /Invalid feature-map surface: wrong.md/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("requires Rung 1 for read-only, Rung 2 for a money client, and Rung 3 for money infrastructure", () => {
  assert.equal(requiredRung(surfaces[0], "apps/web/client/landing/page.tsx"), 1);
  assert.equal(requiredRung(surfaces[1], "apps/web/client/transfers/recipient.tsx"), 2);
  assert.equal(requiredRung(surfaces[1], "apps/web/server/actions/confirm.ts"), 3);
});

const realMap = readSurfaceOwnership(fileURLToPath(new URL("../../../.agents/skills/browser-iteration/surfaces/", import.meta.url)));
const realSurface = (id) => realMap.find((surface) => surface.id === id);

test("maps the money engine directories to their surfaces", () => {
  assert.ok(realSurface("borrow").ownedPaths.some((glob) => pathMatchesGlob("apps/web/server/borrowing/prepare.ts", glob)));
  assert.ok(realSurface("save").ownedPaths.some((glob) => pathMatchesGlob("apps/web/server/savings/prepare.ts", glob)));
  assert.ok(realSurface("save").ownedPaths.some((glob) => pathMatchesGlob("apps/web/server/morpho/client.ts", glob)));
  assert.ok(realSurface("borrow").ownedPaths.some((glob) => pathMatchesGlob("apps/web/server/morpho-markets/rpc.ts", glob)));
  assert.deepEqual(
    verificationEvidenceFindings(["apps/web/server/borrowing/prepare.ts"], "## Verification\n", realMap),
    ["Missing ## Verification row for borrow; Rung 2 is required."],
  );
});

test("requires Rung 3 for the actions routes and the money modal", () => {
  assert.equal(requiredRung(realSurface("send"), "apps/web/app/api/actions/[id]/confirm/route.ts"), 3);
  assert.equal(requiredRung(realSurface("send"), "apps/web/client/money-modal/amount.tsx"), 3);
  assert.equal(requiredRung(realSurface("send"), "apps/web/client/transfers/send-dialog.tsx"), 3);
  assert.equal(requiredRung(realSurface("send"), "apps/web/client/transfers/recipient.tsx"), 2);
});

test("matches surface rows by their leading token and reads only a standalone rung digit", () => {
  const rows = parseVerificationRows(`## Verification

| surface | rung reached | evidence pointer | incidents |
| --- | --- | --- | --- |
| \`dev-ui\` — comment-only change | 0 | /tmp/dev-ui/summary.md | none |
| send | 10 | /tmp/send/summary.md | none |
| save | Rung 3 | /tmp/save/summary.md | none |
`);
  assert.equal(rows.get("dev-ui").rung, 0);
  assert.ok(Number.isNaN(rows.get("send").rung));
  assert.equal(rows.get("save").rung, 3);
});

test("reports a missing rung and accepts a suffixed surface cell", () => {
  assert.deepEqual(
    verificationEvidenceFindings(["apps/web/client/landing/page.tsx"], body.replace("| landing | 1 |", "| landing | 10 |"), surfaces),
    ["Missing rung for landing; Rung 1 is required."],
  );
  assert.deepEqual(
    verificationEvidenceFindings(["apps/web/client/landing/page.tsx"], body.replace("| landing | 1 |", "| landing — read-only copy | 1 |"), surfaces),
    [],
  );
});

test("mapped PRs need a matching evidence or named blocker line without relaxing table/rung checks", () => {
  const files = ["apps/web/server/actions/confirm.ts"];
  const noLines = body.replace("Verified: landing rung 1\nVerified: send rung 3\n", "");
  const missingSend = ["send needs a Verified: or Not verified: line at Rung 3 (with a reason for a blocker)."];
  assert.deepEqual(verificationEvidenceFindings(files, noLines, surfaces), missingSend);
  assert.deepEqual(verificationEvidenceFindings(files, `${noLines}\nVerified: landing rung 1`, surfaces), missingSend);
  assert.deepEqual(verificationEvidenceFindings(files, `${noLines}\nNot verified: send rung 3 — bot account not provisioned`, surfaces), []);
  assert.deepEqual(verificationEvidenceFindings(files, `${noLines}\nNot verified: send rung 3`, surfaces), missingSend);
  assert.deepEqual(verificationEvidenceFindings(files, `${noLines}\nVerified: send rung 2`, surfaces), missingSend);
  assert.deepEqual(verificationEvidenceFindings(files, body.replace("| send | 3 |", "| send | 2 |"), surfaces), [
    "send reports Rung 2; Rung 3 is required.",
  ]);
});

test("requires an individual line for both send and borrow at their required rung", () => {
  const affected = realMap.filter((surface) => surface.id === "send" || surface.id === "borrow");
  const files = ["apps/web/server/actions/confirm.ts"];
  const oneLine = `## Verification

| surface | rung reached | evidence pointer | incidents |
| --- | --- | --- | --- |
| send | 3 | /tmp/send/summary.md | none |
| borrow | 3 | /tmp/borrow/summary.md | none |

Verified: send rung 3
`;
  const missingBorrow = ["borrow needs a Verified: or Not verified: line at Rung 3 (with a reason for a blocker)."];
  assert.deepEqual(verificationEvidenceFindings(files, oneLine, affected), missingBorrow);
  assert.deepEqual(verificationEvidenceFindings(files, `${oneLine}Verified: borrow rung 3\n`, affected), []);
  assert.deepEqual(verificationEvidenceFindings(files, `${oneLine}Not verified: borrow rung 3 — bot unavailable\n`, affected), []);
  assert.deepEqual(verificationEvidenceFindings(files, `${oneLine}Not verified: borrow rung 2 — bot unavailable\n`, affected), missingBorrow);
  const lowerRung = oneLine.replace("| borrow | 3 |", "| borrow | 2 |").replace("Verified: send rung 3", "Verified: borrow rung 3");
  assert.deepEqual(verificationEvidenceFindings(["apps/web/server/borrowing/prepare.ts"], lowerRung, affected), []);
  assert.deepEqual(verificationEvidenceFindings(["apps/web/server/borrowing/prepare.ts"], lowerRung.replace("Verified: borrow rung 3", "Not verified: borrow rung 3 — blocked"), affected), [
    "borrow needs a Verified: or Not verified: line at Rung 2 (with a reason for a blocker).",
  ]);
});

test("passes complete evidence and fails missing, low, or pointerless rows", () => {
  assert.deepEqual(verificationEvidenceFindings([
    "apps/web/client/landing/page.tsx",
    "apps/web/server/actions/confirm.ts",
  ], body, surfaces), []);
  assert.deepEqual(
    verificationEvidenceFindings(["apps/web/client/landing/page.tsx"], "## Verification\n", surfaces),
    ["Missing ## Verification row for landing; Rung 1 is required."],
  );
  assert.deepEqual(
    verificationEvidenceFindings(["apps/web/server/actions/confirm.ts"], body.replace("| send | 3 |", "| send | 2 |"), surfaces),
    ["send reports Rung 2; Rung 3 is required."],
  );
  assert.deepEqual(
    verificationEvidenceFindings(["apps/web/client/landing/page.tsx"], body.replace("| landing | 1 | /tmp/landing/summary.md |", "| landing | 1 | pending |"), surfaces),
    ["landing needs an evidence pointer for Rung 1."],
  );
});

test("reads the pull-request template's Verification section inside the collapsed Evidence block", () => {
  const template = readFileSync(new URL("../../../.github/PULL_REQUEST_TEMPLATE.md", import.meta.url), "utf8");
  const body = template.replace("| N/A | 0 | N/A | none |", "| landing | 1 | preview capture | none |")
    .replace("## Test plan", "Verified: landing rung 1\n\n## Test plan");
  assert.equal(parseVerificationRows(body).get("landing").rung, 1);
  assert.deepEqual(verificationEvidenceFindings(["apps/web/client/landing/page.tsx"], body, surfaces), []);
});
