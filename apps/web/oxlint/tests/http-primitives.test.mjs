import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { describe, expect, it } from "bun:test";
import { budgetMs, createOxlintWorkspace } from "./helpers/oxlint-workspace.mjs";
applyRuleCheckTimeout();

const { directory, lint: lintFixtures } = await createOxlintWorkspace("home-oxlint-http-primitives-", {
  rules: ["no-inline-request-json", "no-manual-abort-timeout"],
});

let fixtureIndex = 0;
async function lint(code, path = `server/fixture-${++fixtureIndex}.ts`, request = {}) {
  return (await lintFixtures({ fixture: { code, path } }, request)).fixture;
}

async function lintCases(cases, rule) {
  const fixtures = Object.fromEntries(cases.map((code, index) => [
    `case${index}`, { code, path: `server/case-${++fixtureIndex}.ts` },
  ]));
  return Object.values(await lintFixtures(fixtures, { rule }));
}

const manualDeadline = "const timeout = setTimeout(() => controller.abort(), timeoutMs);";

describe("no-inline-request-json", () => {
  it("rejects every inline zero-argument JSON parsing case", async () => {
    const cases = [
      "await request.json();",
      "await response.json();",
      "const value = await body.json();",
      "await request?.json();",
      "(await get.json());",
      "void payload.json();",
    ];
    for (const findings of await lintCases(cases, "no-inline-request-json")) {
      expect(findings).toHaveLength(1);
      expect(findings[0].message).toBe('Parse request and response JSON through the shared HTTP helpers instead of an inline ".json()" call.');
    }
  }, budgetMs);

  it("accepts response construction, shared parsing, text, and calls with arguments", async () => {
    const cases = [
      "Response.json({ ok: true });",
      "Response.json(body, { status: 200 });",
      "NextResponse.json(payload, { status: 400 });",
      "JSON.parse(text);",
      "readJson(request);",
      "await response.text();",
      "await response.json({});",
      "Response.json(); NextResponse.json(); JSON.json();",
      'await response["json"]();',
    ];
    for (const findings of await lintCases(cases, "no-inline-request-json")) expect(findings).toHaveLength(0);
  }, budgetMs);

  it("reports shadowed and imported platform names but accepts true globals", async () => {
    const shadowed = [
      "function read(Response: Request) { return Response.json(); }",
      "function read(NextResponse: Request) { return NextResponse.json(); }",
      "function read(JSON: Request) { return JSON.json(); }",
      "const Response = request; Response.json();",
      "let NextResponse = request; NextResponse.json();",
      "var JSON = request; JSON.json();",
      "function Response() {} Response.json();",
      'import { NextResponse } from "next/server"; function read(NextResponse: Request) { return NextResponse.json(); }',
      'import { NextResponse } from "next/server"; NextResponse.json();',
      'import { Response } from "undici"; Response.json();',
      'import JSON from "./json"; JSON.json();',
      'import { request as Response } from "./request"; Response.json();',
      'import { request as NextResponse } from "./request"; NextResponse.json();',
      'import { request as JSON } from "./request"; JSON.json();',
    ];
    for (const findings of await lintCases(shadowed, "no-inline-request-json")) expect(findings).toHaveLength(1);
    const platform = [
      "Response.json(); NextResponse.json(); JSON.json();",
    ];
    for (const findings of await lintCases(platform, "no-inline-request-json")) expect(findings).toHaveLength(0);
  }, budgetMs);

  it("unwraps each supported wrapper around the callee and object", async () => {
    const cases = [
      "(request.json)();",
      "(request.json as () => unknown)();",
      "request.json!();",
      "(request.json satisfies Function)();",
      "(<Function>request.json)();",
      "(request?.json)();",
      "(request as Request).json();",
      "request!.json();",
      "(request satisfies Request).json();",
      "(<Request>request).json();",
    ];
    for (const findings of await lintCases(cases, "no-inline-request-json")) expect(findings).toHaveLength(1);
    expect(await lint("(Response as any).json(); (NextResponse!).json(); (<any>JSON).json();")).toHaveLength(0);
  }, budgetMs);

  it("reports the whole CallExpression rather than its property", async () => {
    const [finding] = await lint("void payload.json();");
    expect(finding.labels[0].span).toMatchObject({ offset: 5, length: 14 });
  }, budgetMs);

  it("has no default exceptions and applies only exact option paths", async () => {
    const path = "server/http/json-probe.ts";
    expect(await lint("request.json();", path)).toHaveLength(1);
    expect(await lint("request.json();", path, {
      rule: "no-inline-request-json", options: { allow: [path] },
    })).toHaveLength(0);
    expect(await lint("request.json();", path, {
      rule: "no-inline-request-json", options: { allow: [] },
    })).toHaveLength(1);
    expect(await lint("request.json();", "other/server/http/json-probe.ts", {
      rule: "no-inline-request-json", options: { allow: [path] },
    })).toHaveLength(1);
  }, budgetMs);

  // Absolute-path resolution is covered by the delivery mirror.
  it("exempts cwd-relative paths but reports nested apps/web marker paths", async () => {
    const cases = [
      ["server/x.ts", "server/x.ts", 0],
      ["./server/x.ts", "server/x.ts", 0],
      ["live-login.ts", "live-login.ts", 0],
      ["apps/web/live-login.ts", "live-login.ts", 1],
      ["server/live-login.ts", "live-login.ts", 1],
      [`${directory}/nested/server/x.ts`, "server/x.ts", 1],
      ["server/nested/apps/web/server/paymaster/client.ts", "server/paymaster/client.ts", 1],
      ["server/paymaster/client.ts", "server/paymaster/client.ts", 0],
    ];
    for (const [path, allowedPath, count] of cases) {
      expect(await lint("request.json();", path, {
        rule: "no-inline-request-json", options: { allow: [allowedPath] },
      }), path).toHaveLength(count);
    }
  }, budgetMs);
});

describe("no-manual-abort-timeout", () => {
  it("rejects every manual abort timeout case", async () => {
    const cases = [
      manualDeadline,
      'function withDeadline(run, ms, parent) { const controller = new AbortController(); let deadline; return Promise.race([run(controller.signal), new Promise((_resolve, reject) => { deadline = setTimeout(() => { controller.abort(new Error("Funding settings read timed out")); reject(new Error("Funding settings read timed out")); }, ms); })]).finally(() => { clearTimeout(deadline); }); }',
      'const timeout = setTimeout(() => controller.abort("reason"), timeoutMs);',
      'const timeout = setTimeout(() => { controller.abort("reason"); reject(new Error("timed out")); }, ms);',
      "const abort = () => controller.abort(); setTimeout(abort, timeoutMs);",
      "const stop = function () { controller.abort(); }; setTimeout(stop, timeoutMs);",
      "window.setTimeout(() => controller.abort(), ms);",
      'const timer = setTimeout(() => deadline?.abort(new DOMException("late", "TimeoutError")), ms);',
      "globalThis.setTimeout(() => controller.abort(), ms);",
    ];
    for (const findings of await lintCases(cases, "no-manual-abort-timeout")) {
      expect(findings).toHaveLength(1);
      expect(findings[0].message).toBe("Do not build a local abort deadline with setTimeout; use the shared upstream deadline or AbortSignal.timeout.");
    }
  }, budgetMs);

  it("accepts every non-abort timer and the approved deadline primitive", async () => {
    const cases = [
      "const timeout = setTimeout(() => resolve(null), budgetMs);",
      "setTimeout(resolve, iconWaitMs);",
      'const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);',
      'const timeout = setTimeout(() => { void reader.cancel("body timed out."); reject(new Error("body timed out")); }, ms);',
      'const timer = setTimeout(() => reject(new Error("webhook-read-timeout")), timeoutMs);',
      "const signal = AbortSignal.timeout(timeoutMs);",
      "const timeout = setTimeout(() => { clearInterval(tick); finish(); }, ms);",
      "const later = () => { controller.abort(); }; later();",
      'setTimeout(() => controller["abort"](), ms);',
      'globalThis["setTimeout"](() => controller.abort(), ms);',
      "other.setTimeout(() => controller.abort(), ms);",
      "setTimeout();",
    ];
    for (const findings of await lintCases(cases, "no-manual-abort-timeout")) expect(findings).toHaveLength(0);
  }, budgetMs);

  it("ignores shadowed timer and timer-object bindings while recognizing platform bindings", async () => {
    const shadowed = [
      "function schedule(setTimeout: (fn: () => void) => void, controller: AbortController) { setTimeout(() => controller.abort()); }",
      "const setTimeout = schedule; setTimeout(() => controller.abort(), ms);",
      "let setTimeout = schedule; setTimeout(() => controller.abort(), ms);",
      "var setTimeout = schedule; setTimeout(() => controller.abort(), ms);",
      "function setTimeout() {} setTimeout(() => controller.abort(), ms);",
      "function schedule(window) { window.setTimeout(() => controller.abort(), ms); }",
      "const window = timers; window.setTimeout(() => controller.abort(), ms);",
      "function schedule(globalThis) { globalThis.setTimeout(() => controller.abort(), ms); }",
      "const globalThis = timers; globalThis.setTimeout(() => controller.abort(), ms);",
      'import { setTimeout } from "node:timers"; function schedule(setTimeout) { setTimeout(() => controller.abort(), ms); }',
      'import window from "./window"; window.setTimeout(() => controller.abort(), ms);',
      'import globalThis from "./global"; globalThis.setTimeout(() => controller.abort(), ms);',
      'import { schedule as setTimeout } from "./timers"; setTimeout(() => controller.abort(), ms);',
      'import { setTimeout } from "./timers"; setTimeout(() => controller.abort(), ms);',
      'import { clearTimeout as setTimeout } from "node:timers"; setTimeout(() => controller.abort(), ms);',
      'import { timers as window } from "./timers"; window.setTimeout(() => controller.abort(), ms);',
      'import { timers as globalThis } from "./timers"; globalThis.setTimeout(() => controller.abort(), ms);',
    ];
    for (const findings of await lintCases(shadowed, "no-manual-abort-timeout")) expect(findings).toHaveLength(0);
    const platform = [
      manualDeadline,
      "window.setTimeout(() => controller.abort(), ms);",
      "globalThis.setTimeout(() => controller.abort(), ms);",
      'import { setTimeout } from "node:timers"; setTimeout(() => controller.abort(), ms);',
      'import { setTimeout } from "timers"; setTimeout(() => controller.abort(), ms);',
    ];
    for (const findings of await lintCases(platform, "no-manual-abort-timeout")) expect(findings).toHaveLength(1);
  }, budgetMs);

  it("unwraps timer, abort, object, and callback expressions", async () => {
    const cases = [
      "(setTimeout)(() => controller.abort(), ms);",
      "(setTimeout as Function)(() => controller.abort(), ms);",
      "setTimeout!(() => controller.abort(), ms);",
      "(setTimeout satisfies Function)(() => controller.abort(), ms);",
      "(<Function>setTimeout)(() => controller.abort(), ms);",
      "(globalThis as any).setTimeout(() => controller.abort(), ms);",
      "window?.setTimeout(() => controller.abort(), ms);",
      "setTimeout(() => (controller.abort as Function)(), ms);",
      "setTimeout(() => controller.abort!(), ms);",
      "setTimeout((() => controller.abort()) as Function, ms);",
      "setTimeout((() => controller.abort())!, ms);",
      "setTimeout((() => controller.abort()) satisfies Function, ms);",
      "setTimeout(<Function>(() => controller.abort()), ms);",
    ];
    for (const findings of await lintCases(cases, "no-manual-abort-timeout")) expect(findings).toHaveLength(1);
  }, budgetMs);

  it("follows immutable aliases and function declarations regardless of declaration order", async () => {
    const cases = [
      "const stop = () => controller.abort(); const alias = stop; setTimeout(alias, ms);",
      "setTimeout(stop, ms); const stop = () => controller.abort();",
      "function stop() { controller.abort(); } setTimeout(stop, ms);",
      "setTimeout(stop, ms); function stop() { controller.abort(); }",
      "function stop() { controller.abort(); } const alias = stop; setTimeout(alias, ms);",
      "const stop = (() => controller.abort()) as Function; const alias = stop!; setTimeout(alias, ms);",
    ];
    for (const findings of await lintCases(cases, "no-manual-abort-timeout")) expect(findings).toHaveLength(1);
  }, budgetMs);

  it("ignores mutable, reassigned, imported, and shadowed callback bindings", async () => {
    const cases = [
      "let stop = () => controller.abort(); setTimeout(stop, ms);",
      "var stop = () => controller.abort(); setTimeout(stop, ms);",
      "const stop = () => controller.abort(); stop = () => resolve(); setTimeout(stop, ms);",
      "const stop = () => controller.abort(); setTimeout(stop, ms); stop = () => resolve();",
      "function stop() { controller.abort(); } stop = () => resolve(); setTimeout(stop, ms);",
      "function stop() { controller.abort(); } function stop() { resolve(); } setTimeout(stop, ms);",
      'import { stop } from "./other"; setTimeout(stop, ms);',
      "const stop = () => controller.abort(); function run(stop) { setTimeout(stop, ms); }",
      "const stop = () => controller.abort(); { const stop = () => resolve(); setTimeout(stop, ms); }",
      "const { stop } = callbacks; setTimeout(stop, ms);",
    ];
    for (const findings of await lintCases(cases, "no-manual-abort-timeout")) expect(findings).toHaveLength(0);
  }, budgetMs);

  it("limits alias resolution to five bindings and safely stops at cycles", async () => {
    expect(await lint(`
      const one = () => controller.abort();
      const two = one; const three = two; const four = three; const five = four;
      setTimeout(five, ms);
    `)).toHaveLength(1);
    expect(await lint(`
      const one = () => controller.abort();
      const two = one; const three = two; const four = three; const five = four; const six = five;
      setTimeout(six, ms);
      const left = right; const right = left; setTimeout(left, ms);
      const self = self; setTimeout(self, ms);
    `)).toHaveLength(0);
  }, budgetMs);

  it("finds abort calls throughout reachable callback bodies", async () => {
    expect(await lint(`
      setTimeout(() => { if (ready) { controller.abort(); } }, ms);
      setTimeout(function () { try { work(); } finally { controller.abort(); } }, ms);
    `)).toHaveLength(2);
  }, budgetMs);

  it("does not descend into uncalled nested functions", async () => {
    const cases = [
      "setTimeout(() => { const stop = () => controller.abort(); cleanup(); }, ms);",
      "setTimeout(() => { const stop = function () { controller.abort(); }; cleanup(); }, ms);",
      "setTimeout(() => { function stop() { controller.abort(); } cleanup(); }, ms);",
      "setTimeout(() => register(() => controller.abort()), ms);",
      "setTimeout(() => { const stop = (x = controller.abort()) => {}; cleanup(); }, ms);",
      "setTimeout(() => { function stop(x = controller.abort()) {} cleanup(); }, ms);",
      "setTimeout(() => register((x = controller.abort()) => {}), ms);",
      'setTimeout(() => { void reader.cancel("x"); reject(new Error("x")); }, ms);',
    ];
    for (const findings of await lintCases(cases, "no-manual-abort-timeout")) expect(findings).toHaveLength(0);
  }, budgetMs);

  it("follows immediately invoked functions and immutable helper calls", async () => {
    const cases = [
      "setTimeout(() => (() => controller.abort())(), ms);",
      "setTimeout(() => (function () { controller.abort(); })(), ms);",
      "const stop = () => controller.abort(); setTimeout(() => stop(), ms);",
      "const stop = function () { controller.abort(); }; setTimeout(() => stop(), ms);",
      "function stop() { controller.abort(); } setTimeout(() => stop(), ms);",
      "setTimeout(() => stop(), ms); function stop() { controller.abort(); }",
      "setTimeout(() => { function stop() { controller.abort(); } stop(); }, ms);",
      "const stop = () => controller.abort(); const alias = stop; setTimeout(() => alias(), ms);",
    ];
    for (const findings of await lintCases(cases, "no-manual-abort-timeout")) expect(findings).toHaveLength(1);
  }, budgetMs);

  it("does not inspect the timer callback's parameter defaults (documented limitation)", async () => {
    expect(await lint("setTimeout((reason = controller.abort()) => {}, 1000);")).toHaveLength(0);
  }, budgetMs);

  it("does not inspect helper parameter defaults when an explicit argument is passed", async () => {
    expect(await lint('function cleanup(reason = controller.abort()) {} setTimeout(() => cleanup("done"), 1000);')).toHaveLength(0);
  }, budgetMs);

  it("stops safely at recursive helpers without losing reachable abort calls", async () => {
    expect(await lint("function stop() { stop(); } setTimeout(() => stop(), ms);")).toHaveLength(0);
    expect(await lint("const stop = () => { stop(); controller.abort(); }; setTimeout(() => stop(), ms);")).toHaveLength(1);
    expect(await lint("function first() { second(); } function second() { first(); } setTimeout(() => first(), ms);")).toHaveLength(0);
    expect(await lint("function first() { second(); } function second() { first(); controller.abort(); } setTimeout(() => first(), ms);")).toHaveLength(1);
  }, budgetMs);

  it("reaches helpers through a long chain regardless of call order", async () => {
    const helpers = `
      function a() { b(); }
      function b() { c(); }
      function c() { d(); }
      function d() { target(); }
      function target() { last(); }
      function last() { controller.abort(); }
    `;
    const cases = [
      `${helpers} setTimeout(() => { a(); target(); }, ms);`,
      `${helpers} setTimeout(() => { target(); a(); }, ms);`,
    ];
    for (const findings of await lintCases(cases, "no-manual-abort-timeout")) expect(findings).toHaveLength(1);
    expect(await lint(`${helpers} setTimeout(() => a(), ms);`)).toHaveLength(1);
  }, budgetMs);

  it("does not cache a negative result that depended on the calling ancestry", async () => {
    const helpers = `
      function a(recurse = true) { if (recurse) b(false); controller.abort(); }
      function b(recurse = true) { if (recurse) a(false); }
    `;
    const cases = [
      `${helpers} setTimeout(a, 1000); setTimeout(() => b(), 1000);`,
      `${helpers} setTimeout(() => b(), 1000); setTimeout(a, 1000);`,
    ];
    for (const code of cases) expect(await lint(code)).toHaveLength(2);
  }, budgetMs);

  it("memoizes repeated helper fanout well within the lint budget", async () => {
    const names = ["a", "b", "c", "d", "e", "f"];
    const helpers = names.slice(0, -1).map((name, index) =>
      `function ${name}() { ${`${names[index + 1]}();`.repeat(60)} }`).join("\n");
    const started = performance.now();
    expect(await lint(`${helpers} setTimeout(() => a(), 1000);`)).toHaveLength(0);
    expect(performance.now() - started).toBeLessThan(10_000);
  }, budgetMs);

  it("memoizes a recursive leaf reached through a repeated fanout", async () => {
    const names = ["a", "b", "c", "d", "e"];
    const helpers = names.slice(0, -1).map((name, index) =>
      `function ${name}() { ${`${names[index + 1]}();`.repeat(60)} }`).join("\n");
    const leaf = "function e(recurse = true) { if (recurse) e(false); }";
    const started = performance.now();
    expect(await lint(`${helpers}\n${leaf}\nsetTimeout(() => a(), 1000);`)).toHaveLength(0);
    expect(performance.now() - started).toBeLessThan(10_000);
  }, budgetMs);

  it("reports both server and server/http paths without internal path scoping", async () => {
    const findings = await lintFixtures({
      server: { code: manualDeadline, path: "server/probe.ts" },
      http: { code: manualDeadline, path: "server/http/probe.ts" },
    }, { rule: "no-manual-abort-timeout" });
    expect(findings.server).toHaveLength(1);
    expect(findings.http).toHaveLength(1);
  }, budgetMs);

  it("reports the whole timer CallExpression", async () => {
    const [finding] = await lint("void setTimeout(() => controller.abort(), ms);");
    expect(finding.labels[0].span).toMatchObject({ offset: 5, length: 40 });
  }, budgetMs);

  it("replaces default exceptions when allow is supplied, including an empty array", async () => {
    const path = "server/actions/follow-through.ts";
    expect(await lint(manualDeadline, path)).toHaveLength(1);
    expect(await lint(manualDeadline, path, {
      rule: "no-manual-abort-timeout", options: { allow: [] },
    })).toHaveLength(1);
    expect(await lint(manualDeadline, path, {
      rule: "no-manual-abort-timeout", options: { allow: ["server/other.ts"] },
    })).toHaveLength(1);
    expect(await lint(manualDeadline, "server/other.ts", {
      rule: "no-manual-abort-timeout", options: { allow: ["server/other.ts"] },
    })).toHaveLength(0);
    expect(await lint(manualDeadline, `${path}x`)).toHaveLength(1);
  }, budgetMs);

  it("does not leak an exact exception into nested same-suffix paths", async () => {
    const findings = await lintFixtures({
      exact: { code: manualDeadline, path: "server/paymaster/client.ts" },
      nested: { code: manualDeadline, path: "server/nested/server/paymaster/client.ts" },
      nestedAppsWeb: { code: manualDeadline, path: "server/nested/apps/web/server/paymaster/client.ts" },
    }, { rule: "no-manual-abort-timeout", options: { allow: ["server/paymaster/client.ts"] } });
    expect(await lint(manualDeadline, `${directory}/nested/server/paymaster/client.ts`, {
      rule: "no-manual-abort-timeout", options: { allow: ["server/paymaster/client.ts"] },
    })).toHaveLength(1);
    expect(findings.exact).toHaveLength(0);
    expect(findings.nested).toHaveLength(1);
    expect(findings.nestedAppsWeb).toHaveLength(1);
    expect(await lint(manualDeadline, "server/nested/server/paymaster/client.ts")).toHaveLength(1);
  }, budgetMs);

  it("exempts cwd-relative timer paths but reports nested apps/web marker paths", async () => {
    const cases = [
      ["./server/x.ts", "server/x.ts", 0],
      ["live-login.ts", "live-login.ts", 0],
      ["apps/web/live-login.ts", "live-login.ts", 1],
      ["server/live-login.ts", "live-login.ts", 1],
      ["server/x.ts", "server/x.ts", 0],
      [`${directory}/nested/server/x.ts`, "server/x.ts", 1],
    ];
    for (const [path, allowedPath, count] of cases) {
      expect(await lint(manualDeadline, path, {
        rule: "no-manual-abort-timeout", options: { allow: [allowedPath] },
      }), path).toHaveLength(count);
    }
  }, budgetMs);

});
