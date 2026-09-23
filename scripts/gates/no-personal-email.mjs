// The verifier's bot mailbox is operator configuration (HOME_VERIFY_ACCOUNT_EMAIL).
// Code, docs, and skill guidance must reference the variable instead of a real
// address, so this gate fails on any personal-email literal in those surfaces.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const scannedRoots = ["apps/web/live-login.ts", "apps/web/fixture-session.sh", "apps/web/verify", "docs", ".agents"];

const personalEmailNeedle = ["@", "pollak.io"].join("");

export function personalEmailFindings(entries) {
  const findings = [];
  for (const entry of entries) {
    const lines = entry.content.split("\n");
    for (const [index, line] of lines.entries()) {
      if (line.toLowerCase().includes(personalEmailNeedle)) {
        findings.push(`${entry.path}:${index + 1}`);
      }
    }
  }
  return findings;
}

export function repositoryEntries(root) {
  const paths = execFileSync("git", ["ls-files", "--", ...scannedRoots], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  return paths.map((path) => ({ path, content: readFileSync(resolve(root, path), "utf8") }));
}
