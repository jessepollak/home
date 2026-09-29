import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const structuralGates = [
  ["mounted-rows", "Rows"],
  ["dom-nodes", "DOM"],
  ["warm-requests", "Warm"],
  ["initial-js", "JS"],
  ["resource-growth", "Growth"],
  ["history-writes", "History"],
];

function validDate(value) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function duration(start, end) {
  const first = validDate(start);
  const last = validDate(end);
  return first && last && last >= first ? (last - first) / 60_000 : null;
}

function number(value, suffix = "") {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? `${value.toFixed(2)}${suffix}` : "no data";
}

function rowFor({ run, results }, current = false) {
  const sha = current ? results?.sha : run?.headSha;
  const date = validDate(current ? results?.startedAt : run?.createdAt);
  const runtime = current ? null : duration(run?.jobStartedAt, run?.jobCompletedAt);
  const attempt = Number.isInteger(run?.runAttempt) && run.runAttempt > 0 ? run.runAttempt : null;
  const conclusion = typeof run?.jobConclusion === "string" && /^[a-z-]+$/.test(run.jobConclusion)
    ? run.jobConclusion : null;
  const gates = structuralGates.map(([id]) => {
    const entries = Array.isArray(results?.structural) ? results.structural.filter((entry) => entry?.id === id) : [];
    if (entries.length === 0 || entries.some((entry) => typeof entry.pass !== "boolean")) return "no data";
    return entries.every((entry) => entry.pass) ? "pass" : "fail";
  });
  const timings = Array.isArray(results?.timing) ? results.timing : [];
  const metric = (id, scenario, property, suffix) => {
    const entry = timings.find((item) => item?.id === id && item?.scenario === scenario);
    return number(entry?.[property], suffix);
  };
  return [
    typeof sha === "string" && /^[0-9a-f]{7,40}$/i.test(sha) ? `\`${sha.slice(0, 8)}\`` : "no data",
    date ? date.toISOString().slice(0, 10) : "no data",
    runtime === null ? "no data" : number(runtime, " min"),
    current ? "in progress" : conclusion ? `${conclusion} / ${attempt ?? "?"}` : "no data",
    ...gates,
    metric("fling-p95", "feed-300", "ratio", "×"),
    metric("fling-p95", "feed-2000", "value", " ms"),
    metric("nav-p95", "nav-300", "value", " ms"),
    metric("detail-open", "feed-300", "value", " ms"),
  ];
}

function median(numbers) {
  if (numbers.length === 0) return null;
  const ordered = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

export function renderTrend(current, history = []) {
  const earlier = (Array.isArray(history) ? history : [])
    .filter((entry) => entry && typeof entry === "object")
    .sort((left, right) => (validDate(right.run?.createdAt)?.valueOf() ?? -Infinity)
      - (validDate(left.run?.createdAt)?.valueOf() ?? -Infinity))
    .slice(0, 20);
  const completed = earlier.filter(({ run }) => ["success", "failure"].includes(run?.jobConclusion));
  const runtimes = completed.map(({ run }) => duration(run?.jobStartedAt, run?.jobCompletedAt))
    .filter((value) => value !== null);
  const flakes = completed.filter(({ run }) => run.runAttempt > 1 || run.jobConclusion === "failure").length;
  const header = [
    "# Performance trend",
    "",
    `Runs: ${earlier.length + 1} (current + ${earlier.length} main); completed performance jobs: ${completed.length}.`,
    `Median completed job runtime: ${number(median(runtimes), " min")}. Flake indicator (rerun or failed job): ${completed.length ? `${((flakes / completed.length) * 100).toFixed(1)}% (${flakes}/${completed.length})` : "no data"}.`,
    "",
    "Timing values are report-only; missing measurements are no data. Current job runtime and conclusion are unavailable until it completes.",
    "",
  ];
  const columns = ["Run", "Date", "Job runtime", "Conclusion / attempt", ...structuralGates.map(([, label]) => label), "300 fling p95 / calibration", "2,000 fling p95", "Nav p95", "Detail-open median"];
  const rows = [rowFor({ results: current }, true), ...earlier.map((entry) => rowFor(entry))];
  return [...header, `| ${columns.join(" | ")} |`, `| ${columns.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");
}

function readJson(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function collectHistory(directory) {
  try {
    return readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory())
      .map((entry) => ({
        run: readJson(path.join(directory, entry.name, "run.json")),
        results: readJson(path.join(directory, entry.name, "results.json")),
      }));
  } catch {
    return [];
  }
}

export function run(argv = process.argv.slice(2), { stdout = process.stdout } = {}) {
  try {
    const current = argv.indexOf("--current");
    const history = argv.indexOf("--history");
    const currentFile = current >= 0 ? argv[current + 1] : null;
    const historyDirectory = history >= 0 ? argv[history + 1] : null;
    stdout.write(`${renderTrend(currentFile ? readJson(currentFile) : null, historyDirectory ? collectHistory(historyDirectory) : [])}\n`);
  } catch {
    stdout.write(`${renderTrend(null)}\n`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
