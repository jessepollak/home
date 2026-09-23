import { appendFile, writeFile } from "node:fs/promises";

const argv = Bun.argv.slice(2);
const args = argv[0] === "agent-browser" ? argv.slice(1) : argv;
const logPath = process.env.FAKE_AGENT_BROWSER_LOG;
if (!logPath) { console.error("FAKE_AGENT_BROWSER_LOG is not set."); process.exit(2); }
await appendFile(logPath, `${JSON.stringify(args)}\n`);
const [command = "", ...rest] = args;
const fail = JSON.parse(process.env.FAKE_AGENT_BROWSER_FAIL_CALL ?? "[]") as string[];
if (fail.length && fail.every((part, index) => args[index] === part)) {
  console.error(`The browser ${command} step failed.`);
  process.exit(1);
}
const refs = JSON.parse(process.env.FAKE_AGENT_BROWSER_REFS ?? "{}") as Record<string, { name: string; role: string; marker?: string }>;
const marked = JSON.parse(process.env.FAKE_AGENT_BROWSER_MARKED ?? "[]") as string[];
let data: Record<string, unknown> = { result: null };
if (command === "snapshot") {
  data = { refs: Object.fromEntries(Object.entries(refs).map(([key, value]) => [key.replace(/^@/, ""), { role: value.role, name: value.name }])),
    snapshot: process.env.FAKE_AGENT_BROWSER_SNAPSHOT ?? "- button \"Continue\" [ref=e1]" };
} else if (command === "get" && rest[0] === "count") {
  data = { count: rest[1] === "[data-money-action-id]" ? marked.length : 0 };
} else if (command === "get" && rest[0] === "attr") {
  data = { value: rest[2] === "data-money-action-id" ? rest[1] === "[data-money-action-id]" ? marked[0] ?? null : refs[rest[1]]?.marker ?? null : null };
} else if (command === "get" && rest[0] === "url") {
  data = { url: process.env.FAKE_AGENT_BROWSER_URL ?? "https://example.com/?account=signin" };
} else if (command === "eval" && rest[0] === "--stdin") {
  const { GlobalRegistrator } = await import("@happy-dom/global-registrator");
  await GlobalRegistrator.register();
  try {
    document.body.innerHTML = process.env.FAKE_AGENT_BROWSER_AUTH_HTML ?? "";
    data = { result: new Function(`return ${await Bun.stdin.text()}`)() as unknown };
  } finally { await GlobalRegistrator.unregister(); }
} else if (command === "eval") {
  data = { result: [] };
} else if (command === "network" && rest[0] === "requests") {
  data = { requests: JSON.parse(process.env.FAKE_AGENT_BROWSER_REQUESTS ?? "[]") as unknown };
} else if (command === "console" || command === "errors") {
  data = { messages: [] };
} else if (command === "state" && rest[0] === "save") {
  if (rest[1]) await writeFile(rest[1], "{}\n", { mode: 0o600 });
} else if (command === "screenshot") {
  const path = rest.filter((value) => value !== "--full" && value !== "--json")[0];
  if (path) await writeFile(path, "", { mode: 0o600 });
}
console.log(JSON.stringify({ success: true, data, error: null }));
