import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  parseSurfaceOwnership,
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

test("requires Rung 1 for read-only, Rung 2 for a money client, and Rung 3 for money infrastructure", () => {
  assert.equal(requiredRung(surfaces[0], "apps/web/client/landing/page.tsx"), 1);
  assert.equal(requiredRung(surfaces[1], "apps/web/client/transfers/recipient.tsx"), 2);
  assert.equal(requiredRung(surfaces[1], "apps/web/server/actions/confirm.ts"), 3);
});

const realMap = parseSurfaceOwnership(readFileSync(new URL("../../../.agents/skills/browser-iteration/feature-map.md", import.meta.url), "utf8"));
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
