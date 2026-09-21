import assert from "node:assert/strict";
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
