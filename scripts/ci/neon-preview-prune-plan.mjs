import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const isPlainObject = (value) => value !== null && typeof value === "object"
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

export function collectBranches(pages) {
  if (!Array.isArray(pages)) throw new Error("pages must be an array");
  const branches = [];
  for (const page of pages) {
    if (!isPlainObject(page)) throw new Error("each page must be a plain object");
    if (!Array.isArray(page.branches)) throw new Error("page.branches must be an array");
    if (page.branches.some((branch) => !isPlainObject(branch)
      || typeof branch.name !== "string" || typeof branch.created_at !== "string")) {
      throw new Error("each branch must be an object with name and created_at strings");
    }
    branches.push(...page.branches);
  }
  if (branches.length === 0) throw new Error("Neon project returned no branches");
  return branches;
}

export function eligiblePreviews(branches) {
  if (!Array.isArray(branches) || branches.some((branch) =>
    !branch || typeof branch !== "object" || typeof branch.name !== "string" || typeof branch.created_at !== "string"
  )) {
    throw new Error("branches must be an array of branches with name and created_at strings");
  }

  return branches
    .filter((branch) => branch.name.startsWith("preview/")
      && !["main", "production", "prod"].includes(branch.name.slice("preview/".length).toLowerCase())
      && branch.default !== true
      && branch.protected !== true)
    .sort((a, b) => a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0);
}

export function planPrune({ branches, stale, cap, headroom }) {
  if (!Number.isSafeInteger(cap) || cap <= 0 || !Number.isSafeInteger(headroom) || headroom < 1 || headroom >= cap) {
    throw new Error("cap and headroom must be positive integers with 1 <= headroom < cap");
  }
  if (!Array.isArray(stale) || stale.some((name) => typeof name !== "string")) {
    throw new Error("stale must be an array of branch names");
  }

  const eligible = eligiblePreviews(branches);
  const staleNames = new Set(stale);
  const staleEligible = eligible.filter((branch) => staleNames.has(branch.name));
  const nonStale = eligible.filter((branch) => !staleNames.has(branch.name));
  const total = branches.length;
  const target = cap - headroom;
  const need = Math.max(0, total - target);
  const plan = staleEligible.concat(nonStale.slice(0, Math.max(0, need - staleEligible.length)));
  const after = total - plan.length;
  const status = after <= target ? "ok" : after < cap ? "short" : "full";
  return { total, target, eligible, plan, after, status };
}

function parsePositiveInteger(value, name) {
  if (!/^[1-9][0-9]*$/.test(value ?? "")) throw new Error(`${name} must be a positive integer`);
  return Number(value);
}

function runCli(args) {
  const branches = JSON.parse(readFileSync(0, "utf8"));
  if (args.length === 1 && args[0] === "eligible") return eligiblePreviews(branches);
  if (args.length === 1 && args[0] === "collect") return collectBranches(branches);
  if (args.length === 7 && args[0] === "plan" && args[1] === "--cap" && args[3] === "--headroom" && args[5] === "--stale") {
    return planPrune({
      branches,
      cap: parsePositiveInteger(args[2], "cap"),
      headroom: parsePositiveInteger(args[4], "headroom"),
      stale: JSON.parse(args[6]),
    });
  }
  throw new Error("usage: collect | eligible | plan --cap N --headroom N --stale '<json array>'");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    console.log(JSON.stringify(runCli(process.argv.slice(2))));
  } catch (error) {
    console.error(`Neon preview prune planner: ${error.message}`);
    process.exitCode = 1;
  }
}
