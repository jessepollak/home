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
const failCall = JSON.parse(process.env.FAKE_AGENT_BROWSER_FAIL_CALL ?? "[]") as string[];
if (failCall.length > 0 && failCall.every((part, index) => args[index] === part)) {
  console.error(`The browser ${command} step failed.`);
  process.exit(1);
}
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
  } else if (expression.includes('__homeVerifyRefHtml=')) {
    const { GlobalRegistrator } = await import("@happy-dom/global-registrator");
    await GlobalRegistrator.register();
    try { result = new Function(`return ${expression}`)() as unknown; }
    finally { await GlobalRegistrator.unregister(); }
  } else if (expression.includes('data-money-action-id') && expression.includes('getClientRects')) {
    const controls = JSON.parse(process.env.FAKE_AGENT_BROWSER_CONTROLS ?? "[]") as Array<{ id: string; name: string }>;
    result = expression.includes('.some(')
      ? controls.some((control) => expression.includes(JSON.stringify(control.name)))
      : controls;
  } else if (expression.includes('[role="dialog"]')) {
    result = process.env.FAKE_AGENT_BROWSER_REVIEW ?? "";
  } else if (expression.includes('aria-label="Total balance"')) {
    result = process.env.FAKE_AGENT_BROWSER_BALANCE ?? null;
  } else if (expression === "document.body.innerText") {
    result = process.env.FAKE_AGENT_BROWSER_BODY ?? "";
  } else if (expression.includes("data-app-main-authenticated")) {
    result = process.env.FAKE_AGENT_BROWSER_AUTHENTICATED === "1";
  } else if (expression.includes("performance.getEntriesByType")) {
    result = { marks: JSON.parse(process.env.FAKE_AGENT_BROWSER_MARKS ?? "[]") as unknown, longTaskCount: 0 };
  } else if (expression.includes('[data-slot="money-ticker"]')) {
    result = process.env.FAKE_AGENT_BROWSER_BALANCE ?? null;
  } else if (expression.includes("__homeVerifyHosts")) {
    result = JSON.parse(process.env.FAKE_AGENT_BROWSER_HOSTS ?? "[]") as unknown;
  } else if (expression.includes("__homeVerifyPrefix")) {
    const configured = JSON.parse(process.env.FAKE_AGENT_BROWSER_PREFIX_NAMES ?? "[]") as string[] | Record<string, string[]>;
    const marker = "__homeVerifyPrefix=";
    const start = expression.indexOf(marker) + marker.length;
    const end = expression.indexOf(";return", start);
    const prefix = JSON.parse(expression.slice(start, end)) as string;
    result = Array.isArray(configured) ? configured : (configured[prefix] ?? []);
  }
} else if (command === "get" && (rest[0] === "attr" || rest[0] === "html")) {
  const refs = JSON.parse(process.env.FAKE_AGENT_BROWSER_REFS ?? "{}") as Record<string, { text?: string; html?: string; attributes?: Record<string, string> }>;
  const ref = refs[rest[1]];
  console.log(JSON.stringify({ success: true, data: rest[0] === "attr"
    ? { value: ref?.attributes?.[rest[2]] ?? null }
    : { html: ref?.html ?? ref?.text ?? "" }, error: null }));
  process.exit(0);
} else if (command === "network" && rest[0] === "har" && rest[1] === "stop") {
  if (rest[2]) await writeFile(rest[2], process.env.FAKE_AGENT_BROWSER_HAR ?? JSON.stringify({ log: { entries: [] } }), { mode: 0o600 });
  result = { saved: true };
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
