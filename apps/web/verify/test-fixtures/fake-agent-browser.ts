import { appendFile, writeFile } from "node:fs/promises";

const argv = Bun.argv.slice(2);
const args = argv[0] === "agent-browser" ? argv.slice(1) : argv;
const logPath = process.env.FAKE_AGENT_BROWSER_LOG;
if (!logPath) {
  console.error("FAKE_AGENT_BROWSER_LOG is not set.");
  process.exit(2);
}
await appendFile(logPath, `${JSON.stringify(args)}\n`);
const [command = "", ...rest] = args;
let result: unknown = null;
if (command === "wait" && rest.includes("--text") && process.env.FAKE_AGENT_BROWSER_FAIL_EXPECT === "1") {
  console.error("The expectation was not observed.");
  process.exit(1);
}
const failWait = process.env.FAKE_AGENT_BROWSER_FAIL_WAIT;
if (command === "wait" && rest.includes("--fn") && (failWait === "1" || (failWait === "enabled" && (rest[1] ?? "").includes("aria-disabled")))) {
  console.error("Timed out waiting for the predicate.");
  process.exit(1);
}
if (command === "eval") {
  const expression = rest[0] ?? "";
  if (expression.startsWith("location.pathname")) {
    result = process.env.FAKE_AGENT_BROWSER_PATH ?? "/home?account=settings";
  } else if (expression.includes("account-heading")) {
    result = process.env.FAKE_AGENT_BROWSER_ADDRESS ?? "";
  } else if (expression === "document.body.innerText") {
    result = process.env.FAKE_AGENT_BROWSER_BODY ?? "";
  } else if (expression.includes("data-app-main-authenticated")) {
    result = process.env.FAKE_AGENT_BROWSER_AUTHENTICATED === "1";
  } else if (expression.includes("performance.getEntriesByType")) {
    result = { marks: [], longTaskCount: 0 };
  } else if (expression.includes('[data-slot="money-ticker"]')) {
    result = process.env.FAKE_AGENT_BROWSER_BALANCE ?? null;
  } else if (expression.includes("__homeVerifyHosts")) {
    result = JSON.parse(process.env.FAKE_AGENT_BROWSER_HOSTS ?? "[]") as unknown;
  }
} else if (command === "network" && rest[0] === "requests") {
  result = JSON.parse(process.env.FAKE_AGENT_BROWSER_FAILURES ?? "[]") as unknown;
} else if (command === "state" && rest[0] === "save") {
  const statePath = rest[1];
  if (statePath) await writeFile(statePath, "{}\n", { mode: 0o600 });
  result = { saved: true };
} else if (command === "screenshot") {
  const screenshotPath = rest.filter((argument) => argument !== "--full")[0];
  if (screenshotPath) await writeFile(screenshotPath, "", { mode: 0o600 });
  result = { saved: true };
}
console.log(JSON.stringify({ data: { result } }));
