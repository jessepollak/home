import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { personalEmailFindings, repositoryEntries, scannedRoots } from "../no-personal-email.mjs";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));

test("flags the personal-email shape and ignores unrelated addresses", () => {
  const literal = ["someone", "@pollak", ".io"].join("");
  assert.deepEqual(
    personalEmailFindings([{ path: "docs/example.md", content: `owner ${literal}\n` }]),
    ["docs/example.md:1"],
  );
  assert.deepEqual(
    personalEmailFindings([{ path: "docs/example.md", content: "owner bot@example.com\n" }]),
    [],
  );
});

test("keeps personal email literals out of the verifier surface", () => {
  assert.ok(scannedRoots.length > 0);
  assert.deepEqual(personalEmailFindings(repositoryEntries(repositoryRoot)), []);
});
