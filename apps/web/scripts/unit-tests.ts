import { readdir, readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { parseJunit } from "../../../scripts/gates/test-runtime.mjs";
import ts from "typescript";

const extensions = new Set(["ts", "tsx", "js", "jsx", "mts", "cts", "mjs", "cjs"]);
const testName = /(?:\.test\.|_test\.|\.spec\.|_spec\.)/;
const countNames = ["tests", "assertions", "failures", "skipped", "time"] as const;
const valueFlags = new Set(["-t", "--test-name-pattern", "--timeout", "--retry", "--rerun-each", "--seed", "--path-ignore-patterns"]);
export const DEFAULT_BATCH_SIZE = 5;
export const DEFAULT_MAX_RSS_MB = 3072;
const unsupportedFlags = ["--watch", "--hot", "--bail"];

function rejectionFor(arg: string) {
  if (arg === "--coverage" || arg.startsWith("--coverage=") || arg.startsWith("--coverage-")) {
    return `${arg} would cover only one batch; run bun test directly for coverage`;
  }
  return unsupportedFlags.some((flag) => arg === flag || arg.startsWith(`${flag}=`))
    ? `${arg} is not supported across batches; run bun test directly for it`
    : null;
}

export async function discoverTests(cwd: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "storybook-static") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && extensions.has(entry.name.split(".").at(-1) ?? "") && testName.test(entry.name)) {
        files.push(`./${relative(cwd, path).replaceAll("\\", "/")}`);
      }
    }
  }
  await visit(cwd);
  return files.sort();
}

export function isDomTestSource(source: string, file = "unit.test.ts") {
  const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false);
  let usesDom = false;
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) {
      usesDom ||= domModule(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      usesDom ||= domModule(node.arguments[0].text);
    }
    if (!usesDom) ts.forEachChild(node, visit);
  }
  visit(syntax);
  return usesDom;
}

function domModule(name: string) {
  return name.includes("dom-test-harness") || name === "@testing-library/react"
    || name === "@happy-dom/global-registrator" || name.includes("tests/helpers/dom");
}

export function splitArgs(args: string[]) {
  const filters: string[] = [];
  const flags: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const rejection = rejectionFor(arg);
    if (rejection) throw new Error(rejection);
    if (!arg.startsWith("-")) {
      filters.push(arg);
      continue;
    }
    flags.push(arg);
    if (valueFlags.has(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith("-")) throw new Error(`${arg} needs a value`);
      flags.push(args[++i]);
    }
  }
  return { filters, flags };
}

export function filterTests(files: string[], filters: string[]) {
  if (!filters.length) return files;
  const scopes = filters.filter((filter) => filter.startsWith("./")).map((filter) => filter.slice(2));
  const substrings = filters.filter((filter) => !filter.startsWith("./"));
  return files.filter((file) => {
    const path = file.replace(/^\.\//, "");
    return scopes.some((scope) => path === scope || path.startsWith(`${scope}/`)) || substrings.some((substring) => path.includes(substring));
  });
}

export function batchTests(files: string[], size: number) {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error("HOME_UNIT_TEST_BATCH_SIZE must be a positive integer");
  return Array.from({ length: Math.ceil(files.length / size) }, (_, index) => files.slice(index * size, (index + 1) * size));
}

export function normalizeRss(maxRSS: number | undefined, platform: string): number | null {
  return maxRSS === undefined ? null : maxRSS * (platform === "darwin" ? 1 : 1024);
}

function junitParts(xml: string) {
  const match = xml.match(/^(?:<\?xml[^>]*\?>\s*)?<testsuites\b([^>]*)>([\s\S]*)<\/testsuites>\s*$/);
  if (!match) throw new Error("Missing testsuites root");
  const totals = Object.fromEntries(countNames.map((name) => {
    const value = match[1].match(new RegExp(`\\b${name}="([0-9]+(?:\\.[0-9]+)?)"`))?.[1];
    if (value === undefined) throw new Error(`Missing JUnit ${name}`);
    return [name, Number(value)];
  })) as Record<(typeof countNames)[number], number>;
  const testcaseCount = [...match[2].matchAll(/<testcase\s/g)].length;
  if (totals.tests !== testcaseCount || (totals.tests > 0 && parseJunit(xml).tests.length === 0)) {
    throw new Error(`JUnit tests count ${totals.tests} does not match ${testcaseCount} testcases`);
  }
  if (totals.tests === 0 && /<testcase\b/.test(match[2])) throw new Error("Unexpected testcase in empty JUnit");
  return { totals, children: match[2] };
}

export function mergeJunit(reports: string[]) {
  const totals = { tests: 0, assertions: 0, failures: 0, skipped: 0, time: 0 };
  const children: string[] = [];
  for (const report of reports) {
    const part = junitParts(report);
    for (const name of countNames) totals[name] += part.totals[name];
    children.push(part.children);
  }
  const attrs = countNames.map((name) => `${name}="${totals[name]}"`).join(" ");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="bun test" ${attrs}>${children.join("")}\n</testsuites>\n`;
}

export type BatchStatus = "pass" | "test failures" | "runtime crash" | "runtime error" | "no matching tests";
export function classifyBatch(exit: number | null, signal: string | null, xml: string | null, nameFilter: boolean): BatchStatus {
  if (signal || (exit !== 0 && exit !== 1)) return "runtime crash";
  if (!xml) return "runtime crash";
  try {
    const { totals } = junitParts(xml);
    if (nameFilter && exit === 1 && totals.skipped === totals.tests && totals.failures === 0) return "no matching tests";
    if (totals.tests === 0) return "runtime crash";
    if (totals.failures > 0) return "test failures";
    return exit === 0 ? "pass" : "runtime error";
  } catch {
    return "runtime crash";
  }
}

export type BatchResult = { index: number; partition: "dom" | "non-dom"; files: string[]; exit: number | null; signal: string | null; status: BatchStatus; peakRssBytes: number | null; seconds: number; overLimit: boolean };
export function summarize(results: BatchResult[]) {
  const counts = { pass: 0, failed: 0, crashed: 0, errored: 0, empty: 0 };
  for (const result of results) {
    if (result.status === "pass") counts.pass++;
    else if (result.status === "runtime crash") counts.crashed++;
    else if (result.status === "runtime error") counts.errored++;
    else if (result.status === "no matching tests") counts.empty++;
    else counts.failed++;
  }
  const max = Math.max(0, ...results.map((result) => result.peakRssBytes ?? 0));
  const seconds = results.reduce((sum, result) => sum + result.seconds, 0);
  return `Batches: ${counts.pass} passed, ${counts.failed} test failures, ${counts.crashed} Bun runtime crashes, ${counts.errored} Bun runtime errors, ${counts.empty} without matching tests (${results.filter((result) => result.partition === "dom").length} DOM, ${results.filter((result) => result.partition === "non-dom").length} non-DOM); max peak RSS ${(max / 1024 ** 3).toFixed(2)} GiB; elapsed ${seconds.toFixed(1)}s`;
}

type CommandResult = { exit: number | null; signal: string | null; maxRSS?: number; seconds: number };
export type Command = (args: string[], cwd: string) => Promise<CommandResult>;
export const spawnCommand: Command = async (args, cwd) => {
  const start = performance.now();
  const child = Bun.spawn(["bun", "test", "--max-concurrency", "1", ...args], { cwd, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  const exit = await child.exited;
  return { exit, signal: child.signalCode ?? null, maxRSS: child.resourceUsage()?.maxRSS, seconds: (performance.now() - start) / 1000 };
};

function positiveInteger(value: string | undefined, fallback: number, key: string) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${key} must be a positive integer`);
  return parsed;
}

export async function run(args = Bun.argv.slice(2), options: { cwd?: string; env?: Record<string, string | undefined>; command?: Command; log?: (message: string) => void } = {}) {
  const cwd = resolve(options.cwd ?? join(import.meta.dir, ".."));
  const env = options.env ?? process.env;
  const log = options.log ?? console.log;
  const output = join(cwd, "unit-test-results");
  await rm(output, { force: true, recursive: true });
  const { filters, flags } = splitArgs(args);
  const files = filterTests(await discoverTests(cwd), filters);
  if (!files.length) throw new Error(`No unit test files match: ${filters.join(", ") || "discovery"}`);
  const size = positiveInteger(env.HOME_UNIT_TEST_BATCH_SIZE, DEFAULT_BATCH_SIZE, "HOME_UNIT_TEST_BATCH_SIZE");
  const dom = new Set<string>();
  for (const file of files) {
    if (isDomTestSource(await readFile(join(cwd, file), "utf8"), file)) dom.add(file);
  }
  const batches = ([
    ...batchTests(files.filter((file) => !dom.has(file)), size).map((files) => ({ files, partition: "non-dom" as const })),
    ...batchTests(files.filter((file) => dom.has(file)), size).map((files) => ({ files, partition: "dom" as const })),
  ]);
  const maxRssBytes = positiveInteger(env.HOME_UNIT_TEST_MAX_RSS_MB, DEFAULT_MAX_RSS_MB, "HOME_UNIT_TEST_MAX_RSS_MB") * 1024 ** 2;
  await mkdir(join(output, "batches"), { recursive: true });
  const results: BatchResult[] = [];
  const reports: string[] = [];
  for (const [offset, { files: batch, partition }] of batches.entries()) {
    const index = offset + 1;
    const outfile = join(output, "batches", `${index}.xml`);
    log(`Batch ${index}/${batches.length} (${partition}): ${batch.length} files`);
    let commandResult: CommandResult;
    try {
      commandResult = await (options.command ?? spawnCommand)([...(partition === "dom" ? ["--preload", "./client/account/dom-test-harness.ts"] : []), "--reporter=junit", `--reporter-outfile=${outfile}`, ...flags, ...batch], cwd);
    } catch (error) {
      log(`Batch ${index} spawn error: ${String(error)}`);
      commandResult = { exit: null, signal: null, seconds: 0 };
    }
    const xml = await readFile(outfile, "utf8").catch(() => null);
    let status = classifyBatch(commandResult.exit, commandResult.signal, xml, flags.includes("-t") || flags.some((flag) => flag.startsWith("--test-name-pattern")));
    if (xml) {
      try { junitParts(xml); reports.push(xml); } catch { status = "runtime crash"; }
    }
    const peakRssBytes = normalizeRss(commandResult.maxRSS, process.platform);
    const overLimit = peakRssBytes !== null && peakRssBytes > maxRssBytes;
    const result = { index, partition, files: batch, exit: commandResult.exit, signal: commandResult.signal, status, peakRssBytes, seconds: commandResult.seconds, overLimit };
    results.push(result);
    log(`Batch ${index} (${partition}): ${status}; exit=${result.exit} signal=${result.signal ?? "none"}; peak RSS ${peakRssBytes === null ? "unknown" : `${(peakRssBytes / 1024 ** 3).toFixed(2)} GiB`}; ${result.seconds.toFixed(1)}s${overLimit ? `; RSS ceiling exceeded (${(maxRssBytes / 1024 ** 3).toFixed(2)} GiB)` : ""}`);
  }
  if (reports.length) {
    const merged = mergeJunit(reports);
    await writeFile(join(output, "junit.xml"), merged);
    const totals = junitParts(merged).totals;
    log(`JUnit: ${totals.tests - totals.failures - totals.skipped} pass, ${totals.failures} fail, ${totals.skipped} skip across ${files.length} files`);
  }
  await writeFile(join(output, "memory.json"), `${JSON.stringify({ batches: results }, null, 2)}\n`);
  log(summarize(results));
  for (const result of results) {
    if (result.status === "runtime crash") log(`Batch ${result.index} is a Bun runtime crash, not a test failure (exit=${result.exit}, signal=${result.signal ?? "none"}): ${result.files.join(", ")}`);
    if (result.status === "runtime error") log(`Batch ${result.index} is a Bun runtime error, not a test failure (exit=${result.exit}; the report records no failing testcase): ${result.files.join(", ")}`);
    if (result.overLimit) log(`Batch ${result.index} exceeds peak RSS ceiling: ${result.files.join(", ")}`);
  }
  if (results.every((result) => result.status === "no matching tests")) log("No tests matched the name filter in any batch.");
  const failed = results.some((result) => result.overLimit || result.status === "test failures" || result.status === "runtime crash" || result.status === "runtime error");
  return failed || results.every((result) => result.status === "no matching tests") ? 1 : 0;
}

if (import.meta.main) {
  try { process.exitCode = await run(); }
  catch (error) { console.error(String(error)); process.exitCode = 1; }
}
