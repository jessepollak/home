import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { readLedger } from "./ledger";

const root = resolve(import.meta.dir, "../../..");
const home = resolve(tmpdir(), `home-verify-session-test-${crypto.randomUUID()}`);
const fakeBin = resolve(home, "bin");
const logPath = resolve(home, "browser.log");
const output = resolve(home, "evidence");
const provenanceDir = resolve(home, ".home-verify", "example.com", "state");
const email = "bot@example.com";
const marker = "11111111-1111-4111-8111-111111111111";
Bun.spawnSync(["mkdir", "-p", fakeBin]);
const fake = resolve(import.meta.dir, "test-fixtures/fake-agent-browser.ts");
await Bun.write(resolve(fakeBin, "bunx"), `#!/bin/sh\nexec '${process.execPath}' '${fake}' "$@"\n`);
Bun.spawnSync(["chmod", "755", resolve(fakeBin, "bunx")]);
afterAll(() => { Bun.spawnSync(["rm", "-rf", home]); });

function env(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return { PATH: `${fakeBin}:${process.env.PATH ?? ""}`, FAKE_AGENT_BROWSER_LOG: logPath,
    HOME_VERIFY_ACCOUNT_EMAIL: email, ...overrides };
}
function run(args: string[], extra: Record<string, string | undefined> = {}, preload?: string) {
  const result = Bun.spawnSync({ cmd: preload ? ["bun", "--preload", preload, "apps/web/verify/cli.ts", ...args] : ["bun", "apps/web/verify/cli.ts", ...args], cwd: root,
    env: { ...process.env, HOME: home, CI: undefined, GITHUB_ACTIONS: undefined, ...env(extra) }, stdout: "pipe", stderr: "pipe" });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}
function calls(): string[][] {
  const result = Bun.spawnSync(["cat", logPath], { stdout: "pipe", stderr: "pipe" });
  return result.stdout.toString().trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
}
async function resetLog() { await Bun.write(logPath, ""); }
async function seedProvenance(role = "operator", configuredEmail = email) {
  Bun.spawnSync(["mkdir", "-p", provenanceDir]);
  await Bun.write(resolve(provenanceDir, "browser-state.json"), "{}\n");
  await Bun.write(resolve(provenanceDir, "provenance.json"), JSON.stringify({ version: 1,
    emailHash: createHash("sha256").update(configuredEmail.toLowerCase()).digest("hex"), createdAt: new Date().toISOString(), role }));
  Bun.spawnSync(["chmod", "600", resolve(provenanceDir, "browser-state.json"), resolve(provenanceDir, "provenance.json")]);
}
const liveArgs = (name: string, extra: string[] = []) => ["start", "send", "--live", "--allow-confirm", "--base-url", "https://example.com", "--out", output, "--session", name, ...extra];
const markedEnv = { FAKE_AGENT_BROWSER_MARKED: JSON.stringify([marker]), FAKE_AGENT_BROWSER_REFS: JSON.stringify({ "@e1": { role: "button", name: "Confirm", marker } }) };

describe("agent-driven verify", () => {
  test("live-login writes mailbox provenance while secrets travel only on stdin", async () => {
    await resetLog();
    const credentials = resolve(home, "gmail.json");
    await Bun.write(credentials, JSON.stringify({ client_id: "client", client_secret: "secret", refresh_token: "refresh" }));
    Bun.spawnSync(["chmod", "600", credentials]);
    const authHtml = '<label>Access password<input type="password"></label><label for="account-otp">Verification code<span aria-hidden="true">*</span></label><input id="account-otp">';
    const login = run(["live-login", "--base-url", "https://example.com"], {
      HOME_VERIFY_GMAIL_CREDENTIALS: credentials, HOME_ACCESS_PASSWORD: "mock-access-secret",
      FAKE_AGENT_BROWSER_URL: "https://example.com/access?next=%2Fhome", FAKE_AGENT_BROWSER_AUTH_HTML: authHtml,
    }, resolve(import.meta.dir, "test-fixtures/fake-gmail-fetch.ts"));
    expect(login.exitCode).toBe(0);
    expect(login.stdout).toContain("Saved a private live session");
    expect(`${login.stdout}${login.stderr}${JSON.stringify(calls())}`).not.toContain("847291");
    expect(`${login.stdout}${login.stderr}${JSON.stringify(calls())}`).not.toContain("mock-access-secret");
    expect(calls().filter((call) => call[0] === "eval" && call[1] === "--stdin")).toHaveLength(2);
    expect(run(liveArgs("from-login")).exitCode).toBe(0);
    expect(run(["finish", "--session", "from-login"]).exitCode).toBe(0);
  });

  test("refuses CI, invalid roles and live state without login provenance before browser launch", async () => {
    await resetLog();
    expect(run(liveArgs("ci"), { CI: "true" }).stderr).toContain("cannot run in CI");
    expect(run(liveArgs("missing"), { HOME_VERIFY_ACCOUNT_EMAIL: "unprovisioned@example.com" }).stderr).toContain("No matching live-login provenance");
    await seedProvenance("factory");
    expect(run(liveArgs("wrong-role")).stderr).toContain("No matching live-login provenance");
    await seedProvenance();
    expect(run(liveArgs("wrong-mailbox"), { HOME_VERIFY_ACCOUNT_EMAIL: "other@example.com" }).stderr).toContain("No matching live-login provenance");
    expect(calls()).toEqual([]);
  });

  test("starts fixture sessions, navigates from snapshots, and fences the marked ref", async () => {
    await resetLog();
    expect(run(["start", "send", "--session", "fixture", "--out", output]).exitCode).toBe(0);
    expect(run(["snapshot", "--session", "fixture"]).stdout).toContain("refs");
    const ordinary = { FAKE_AGENT_BROWSER_REFS: JSON.stringify({ "@e1": { role: "link", name: "Go home" } }) };
    expect(run(["click", "Go home", "--session", "fixture"], ordinary).exitCode).toBe(0);
    expect(calls()).toContainEqual(["click", "@e1", "--json"]);
    const refused = run(["click", "@e1", "--session", "fixture"], markedEnv);
    expect(refused.stderr).toContain("marked money control");
    expect(run(["snapshot", "--session", "fixture"]).exitCode).toBe(2);
  });

  test("ambiguous and missing names are recoverable without a browser click", async () => {
    await resetLog();
    expect(run(["start", "send", "--session", "names", "--out", output]).exitCode).toBe(0);
    const refs = { FAKE_AGENT_BROWSER_REFS: JSON.stringify({ "@e1": { name: "Continue", role: "button" }, "@e2": { name: "Continue", role: "link" } }) };
    expect(run(["click", "Continue", "--session", "names"], refs).stderr).toContain("found 2");
    expect(run(["click", "Missing", "--session", "names"], refs).stderr).toContain("found 0");
    expect(run(["click", "@e2", "--session", "names"], refs).exitCode).toBe(0);
    expect(run(["finish", "--session", "names"], refs).exitCode).toBe(0);
  });

  test("unquoted click usage is recoverable; normalized API goto is terminal", async () => {
    await resetLog();
    expect(run(["start", "send", "--session", "usage", "--out", output]).exitCode).toBe(0);
    expect(run(["click", "Decimal", "point", "--session", "usage"]).stderr).toContain("Usage: verify click");
    expect(run(["goto", "/home", "--session", "usage"]).exitCode).toBe(0);
    expect(run(["goto", "/home/../api/actions", "--session", "usage"]).stderr).toContain("app path");
    expect(run(["snapshot", "--session", "usage"]).exitCode).toBe(2);
  });

  test("live press and off-origin goto refuse without dispatch", async () => {
    await seedProvenance();
    await resetLog();
    expect(run(liveArgs("press")).exitCode).toBe(0);
    expect(run(["press", "Enter", "--session", "press"]).stderr).toContain("refuses press");
    expect(run(liveArgs("origin")).exitCode).toBe(0);
    expect(run(["goto", "https://elsewhere.example/", "--session", "origin"]).stderr).toContain("app path");
    expect(calls().some((entry) => entry[0] === "press" || entry.some((value) => value.includes("elsewhere.example")))).toBe(false);
  });

  test("fixture confirm clicks one marked element without a ledger entry or count limit", async () => {
    await resetLog();
    const before = (await readLedger(resolve(home, ".home-verify", "ledger.jsonl"))).length;
    expect(run(["start", "send", "--session", "fixture-confirm", "--out", output]).exitCode).toBe(0);
    expect(run(["confirm", "--session", "fixture-confirm"], markedEnv).exitCode).toBe(0);
    expect(run(["confirm", "--session", "fixture-confirm"], markedEnv).exitCode).toBe(0);
    expect(run(["finish", "--session", "fixture-confirm"], markedEnv).exitCode).toBe(0);
    expect((await readLedger(resolve(home, ".home-verify", "ledger.jsonl"))).length).toBe(before);
    expect(calls().filter((entry) => entry[0] === "click")).toEqual([
      ["click", "[data-money-action-id]", "--json"], ["click", "[data-money-action-id]", "--json"],
    ]);
  });

  test("factory role cannot start a funded session", async () => {
    await seedProvenance("factory");
    await resetLog();
    expect(run(liveArgs("factory"), { HOME_VERIFY_ROLE: "factory" }).stderr).toContain("operator role");
    expect(calls()).toEqual([]);
  });

  test("an unexpected host refuses live confirmation before reservation", async () => {
    await seedProvenance();
    await resetLog();
    const ledgerPath = resolve(home, ".home-verify", "ledger.jsonl");
    const before = (await readLedger(ledgerPath)).filter((entry) => entry.confirmCount === 1).length;
    expect(run(liveArgs("host")).exitCode).toBe(0);
    const attempt = run(["confirm", "--session", "host"], { ...markedEnv,
      FAKE_AGENT_BROWSER_REQUESTS: JSON.stringify([{ url: "https://unexpected.example.net/image.png" }]) });
    expect(attempt.stderr).toContain("Unexpected network hosts");
    expect(calls().some((entry) => entry[0] === "click")).toBe(false);
    expect((await readLedger(ledgerPath)).filter((entry) => entry.confirmCount === 1)).toHaveLength(before);
  });

  test("an explicit session count reserves each marked click once", async () => {
    await seedProvenance();
    await resetLog();
    const name = "two-confirms";
    expect(run(liveArgs(name, ["--max-confirms", "2"])).exitCode).toBe(0);
    expect(run(["confirm", "--session", name], markedEnv).exitCode).toBe(0);
    expect(run(["confirm", "--session", name], markedEnv).exitCode).toBe(0);
    expect(run(["confirm", "--session", name], markedEnv).stderr).toContain("session limit");
    expect(calls().filter((entry) => entry[0] === "click")).toHaveLength(2);
    const entries = await readLedger(resolve(home, ".home-verify", "ledger.jsonl"));
    expect(entries.filter((entry) => entry.actionIds?.includes(marker) && entry.confirmCount === 1)).toHaveLength(2);
  });

  test("cannot add confirmation authority after a live session starts", async () => {
    await seedProvenance();
    await resetLog();
    expect(run(["start", "send", "--live", "--base-url", "https://example.com", "--out", output, "--session", "read-only"]).exitCode).toBe(0);
    expect(run(["confirm", "--allow-confirm", "--session", "read-only"], markedEnv).stderr).toContain("fixed at start");
    expect(calls().some((entry) => entry[0] === "click")).toBe(false);
  });

  test("live confirm requires operator authority and reserves one count before click", async () => {
    await seedProvenance();
    await resetLog();
    const name = "bounded";
    const ledgerPath = resolve(home, ".home-verify", "ledger.jsonl");
    const before = (await readLedger(ledgerPath)).filter((entry) => entry.actionIds?.includes(marker) && entry.confirmCount === 1).length;
    expect(run(liveArgs(name, ["--max-confirms", "1"])).exitCode).toBe(0);
    expect(run(["confirm", "--session", name], markedEnv).exitCode).toBe(0);
    const refused = run(["confirm", "--session", name], markedEnv);
    expect(refused.stderr).toContain("session limit");
    const entries = await readLedger(ledgerPath);
    expect(entries.filter((entry) => entry.actionIds?.includes(marker) && entry.confirmCount === 1)).toHaveLength(before + 1);
    expect(calls().filter((entry) => entry[0] === "click")).toHaveLength(1);
  });

  test("daily count includes legacy reservations and refuses before a sixth click", async () => {
    await seedProvenance();
    await resetLog();
    const ledgerPath = resolve(home, ".home-verify", "ledger.jsonl");
    const today = new Date().toISOString().slice(0, 10);
    Bun.spawnSync(["mkdir", "-p", resolve(home, ".home-verify")]);
    await Bun.write(ledgerPath, `${JSON.stringify({ type: "run", timestamp: `${today}T12:00:00.000Z`, runId: "legacy", host: "example.com", surface: "send", role: "factory", mainRevision: "old", rungReached: 3, amountsUsd: [0.1, 0.1, 0.1, 0.1, 0.1], incidents: [], clean: false })}\n`);
    expect(run(liveArgs("daily")).exitCode).toBe(0);
    expect(run(["confirm", "--session", "daily"], markedEnv).stderr).toContain("daily limit");
    expect(calls().some((entry) => entry[0] === "click")).toBe(false);
  });

  test("confirmation refuses zero or multiple markers", async () => {
    await seedProvenance();
    await resetLog();
    for (const [index, values] of [[], [marker, marker]].entries()) {
      const name = `count-${index}`;
      expect(run(liveArgs(name)).exitCode).toBe(0);
      expect(run(["confirm", "--session", name], { FAKE_AGENT_BROWSER_MARKED: JSON.stringify(values) }).stderr).toContain("Exactly one marked money control");
    }
    expect(calls().some((entry) => entry[0] === "click")).toBe(false);
  });
});
