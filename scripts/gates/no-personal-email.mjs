// The bot mailbox is runtime configuration (HOME_VERIFY_ACCOUNT_EMAIL).
// Live-login, docs, and skill guidance must reference the variable rather than
// commit a personal-email literal.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const scannedRoots = ["apps/web/live-login.ts", "apps/web/fixture-session.sh", "apps/web/gmail.ts", "apps/web/gmail.test.ts", "docs", ".agents"];

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
