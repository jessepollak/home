#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const PUBLIC_EMAIL = /^(?:[^@\s]+@users\.noreply\.github\.com|noreply@github\.com)$/;
const LOG_FORMAT = "%H%x00%ae%x00%ce%x00%(trailers:key=Co-authored-by,valueonly)";

export function checkCommitMetadata(range) {
  const output = execFileSync(
    "git",
    ["log", "-z", "--no-show-signature", `--format=${LOG_FORMAT}`, range],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const fields = output.split("\0");
  if (fields.at(-1) === "") fields.pop();
  if (fields.length % 4 !== 0) throw new Error("unexpected git metadata output");

  const violations = [];
  for (let index = 0; index < fields.length; index += 4) {
    const [sha, authorEmail, committerEmail, coAuthorTrailers] = fields.slice(index, index + 4);
    if (!PUBLIC_EMAIL.test(authorEmail)) violations.push({ sha, field: "author.email" });
    if (!PUBLIC_EMAIL.test(committerEmail)) violations.push({ sha, field: "committer.email" });
    if (coAuthorTrailers !== "") violations.push({ sha, field: "trailer.Co-authored-by" });
  }
  return violations;
}

export function runCommitMetadataCheck(args) {
  if (args.length !== 1 || args[0] === "") {
    console.error("Commit metadata check failed: explicit commit range required.");
    return 1;
  }

  let violations;
  try {
    violations = checkCommitMetadata(args[0]);
  } catch {
    console.error("Commit metadata check failed: commit range unavailable.");
    return 1;
  }

  for (const { sha, field } of violations) console.error(`${sha} ${field}`);
  return violations.length === 0 ? 0 : 1;
}

let isDirectExecution = false;
try {
  const [modulePath, invocationPath] = await Promise.all([
    realpath(fileURLToPath(import.meta.url)),
    realpath(process.argv[1]),
  ]);
  isDirectExecution = modulePath === invocationPath;
} catch {
  console.error("Commit metadata check failed: invocation path unavailable.");
  process.exitCode = 1;
}

if (isDirectExecution) process.exitCode = runCommitMetadataCheck(process.argv.slice(2));
