import { afterAll, describe, expect, it } from "bun:test";
import { cp, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const appsWebDir = fileURLToPath(new URL("../..", import.meta.url));
const mirror = await mkdtemp(path.join(tmpdir(), "home-oxlint-observability-"));
await cp(path.join(appsWebDir, "oxlint"), path.join(mirror, "oxlint"), { recursive: true });
await symlink(path.join(appsWebDir, "node_modules"), path.join(mirror, "node_modules"), "dir");
afterAll(() => rm(mirror, { recursive: true, force: true }));

let fixtureIndex = 0;
async function lint(rule, code, options) {
  fixtureIndex += 1;
  const fixture = `fixture-${fixtureIndex}.ts`;
  const config = `.oxlintrc-${fixtureIndex}.json`;
  await writeFile(path.join(mirror, fixture), code);
  await writeFile(path.join(mirror, config), JSON.stringify({
    plugins: [],
    categories: { correctness: "off" },
    jsPlugins: ["./oxlint/home-plugin.mjs"],
    rules: { [`home/${rule}`]: options ? ["error", options] : "error" },
  }));
  const result = spawnSync(
    path.join(appsWebDir, "node_modules", ".bin", "oxlint"),
    ["-c", config, "--disable-nested-config", "-f", "json", fixture],
    { cwd: mirror, encoding: "utf8" },
  );
  expect(result.signal).toBeNull();
  expect([0, 1]).toContain(result.status);
  return JSON.parse(result.stdout).diagnostics.filter((diagnostic) =>
    diagnostic.code === `home(${rule})`);
}

describe("no-silent-catch", () => {
  const options = {
    reportingHelpers: ["emitServerEvent", "writeObservabilityEvent", "reportClientError", "observeSafely"],
    reportingModules: ["@/server/observability/log", "@/client/observability/client-reporter"],
  };
  const messages = {
    empty: "Empty catch clauses and rejection handlers are forbidden; return or throw a typed error result, or report the failure.",
    silent: "Caught failures and rejection handlers must be rethrown, returned as a typed error result, or passed to an approved reporting helper.",
  };

  it("rejects empty, comment-only, and bare-return catches", async () => {
    expect(await lint("no-silent-catch", `
      try { run(); } catch {}
      try { run(); } catch { /* intentionally empty */ }
      function read() { try { run(); } catch { return; } }
    `, options)).toHaveLength(3);
  });

  it("accepts throws, explicit return values, reporting, recovery state, and promise settlement", async () => {
    expect(await lint("no-silent-catch", `
      import { emitServerEvent } from "@/server/observability/log";
      function a() { try { run(); } catch (error) { throw error; } }
      function b() { try { run(); } catch { return { ok: false }; } }
      function c() { try { run(); } catch { return null; } }
      function d() { try { run(); } catch { return undefined; } }
      try { run(); } catch (error) { emitServerEvent(error); }
      try { run(); } catch { setError("failed"); }
      try { run(); } catch { dispatch({ type: "failed" }); }
      try { run(); } catch (error) { reject(error); }
    `, options)).toHaveLength(0);
  });

  it("accepts any non-undefined outer recovery value when it is read after the catch", async () => {
    expect(await lint("no-silent-catch", `
      let status = "ready";
      let count = 1;
      let details = { ready: true };
      try { run(); } catch { status = ""; }
      try { run(); } catch { count = 0; }
      try { run(); } catch { details = {}; }
      consume(status, count, details);
    `, options)).toHaveLength(0);
  });

  it("accepts a retained pre-initialized fallback assigned by the try", async () => {
    expect(await lint("no-silent-catch", `
      let details = { code: null };
      try { details = readDetails(); } catch {}
      consume(details);
    `, options)).toHaveLength(0);
  });

  it("rejects undefined fallbacks, undefined reassignment, and late declarations", async () => {
    expect(await lint("no-silent-catch", `
      let typed = undefined as { code: null } | undefined;
      try { typed = readDetails(); } catch {}
      consume(typed);
    `, options)).toHaveLength(1);
    expect(await lint("no-silent-catch", `
      let overwritten = { code: null };
      try { overwritten = undefined; overwritten = readDetails(); } catch {}
      consume(overwritten);
    `, options)).toHaveLength(1);
    expect(await lint("no-silent-catch", `
      try { hoisted = readDetails(); } catch {}
      if (condition) { var hoisted = { code: null }; }
      consume(hoisted);
    `, options)).toHaveLength(1);
  });

  it("rejects missing or undefined initializers and pre-initialized bindings not read after the try", async () => {
    expect(await lint("no-silent-catch", `
      let missing;
      try { missing = readDetails(); } catch {}
      consume(missing);
      let undefinedFallback = undefined;
      try { undefinedFallback = readDetails(); } catch {}
      consume(undefinedFallback);
      let unread = { code: null };
      try { unread = readDetails(); } catch {}
    `, options)).toHaveLength(3);
  });

  it("rejects type-asserted undefined initializers and assignments", async () => {
    expect(await lint("no-silent-catch", `
      let assertedFallback = <undefined>undefined;
      try { assertedFallback = readDetails(); } catch {}
      consume(assertedFallback);
      let asserted = "ready";
      try { run(); } catch { asserted = <undefined>undefined; }
      consume(asserted);
    `, options)).toHaveLength(2);
  });

  it("accepts primitive and empty-literal returns", async () => {
    expect(await lint("no-silent-catch", `
      function zero() { try { run(); } catch { return 0; } }
      function blank() { try { run(); } catch { return ""; } }
      function no() { try { run(); } catch { return false; } }
      function object() { try { run(); } catch { return {}; } }
      function array() { try { run(); } catch { return []; } }
    `, options)).toHaveLength(0);
  });

  it("rejects outer assignments of undefined or values that are never read", async () => {
    expect(await lint("no-silent-catch", `
      let result = "ready";
      try { run(); } catch { result = undefined; }
      consume(result);
      let unread = "ready";
      try { run(); } catch { unread = "failed"; }
      unread = "replaced";
    `, options)).toHaveLength(2);
  });

  it("rejects discards and dispositions that do not dominate the catch body", async () => {
    expect(await lint("no-silent-catch", `
      import { emitServerEvent } from "@/server/observability/log";
      try { run(); } catch (error) { void error; }
      try { run(); } catch (error) { error; }
      try { run(); } catch { 0; }
      function partial(condition) {
        try { run(); } catch { if (condition) return { ok: false }; }
      }
      let status = "ready";
      try { run(); } catch { if (condition) status = "failed"; }
      consume(status);
      try { run(); } catch (error) { if (condition) emitServerEvent(error); }
    `, options)).toHaveLength(6);
  });

  it("accepts dispositions that cover every catch path", async () => {
    expect(await lint("no-silent-catch", `
      function complete(condition) {
        try { run(); } catch {
          if (condition) return { ok: false };
          return { ok: false, reason: "other" };
        }
      }
      function branches(condition) {
        try { run(); } catch {
          if (condition) return { ok: false };
          else return { ok: false, reason: "other" };
        }
      }
      let status = "ready";
      try { run(); } catch { if (condition) status = "failed"; else status = "idle"; }
      consume(status);
    `, options)).toHaveLength(0);
  });

  it("accepts failures disposed by same-file helpers that throw or report", async () => {
    expect(await lint("no-silent-catch", `
      import { emitServerEvent } from "@/server/observability/log";
      function unsupported(): never { throw new Error("unsupported"); }
      function unavailable(cause: unknown): never { throw new Error(String(cause)); }
      function observeStoreFailure(code: string): void { emitServerEvent(code); }
      try { run(); } catch { unsupported(); }
      try { run(); } catch (error) { unavailable(error); }
      try { run(); } catch (error) { if (error instanceof Error) throw error; unavailable(error); }
      try { run(); } catch { observeStoreFailure("failed"); }
    `, options)).toHaveLength(0);
  });

  it("rejects a no-op binding that shares a name with a throwing same-file helper", async () => {
    expect(await lint("no-silent-catch", `
      function recordFailure(): never { throw new Error("failed"); }
      function handle(createNoop: () => () => void): void {
        const recordFailure = createNoop();
        try { run(); } catch { recordFailure(); }
      }
    `, options)).toHaveLength(1);
  });

  it("rejects same-file helpers that only return values or fall through", async () => {
    expect(await lint("no-silent-catch", `
      function ignore(): null { return null; }
      function noop(): void { }
      try { run(); } catch { ignore(); }
      try { run(); } catch { noop(); }
    `, options)).toHaveLength(2);
  });

  it("accepts a nested retry that assigns state or returns on every path", async () => {
    expect(await lint("no-silent-catch", `
      let state;
      try { run(); } catch {
        try { state = read(); } catch { throw new Error("retry failed"); }
      }
      consume(state);
      function decode(data: string): string | null {
        try { return parse(data); } catch {
          try { return parseFallback(data); } catch { return null; }
        }
      }
    `, options)).toHaveLength(0);
  });

  it("rejects a nested try whose handler falls through", async () => {
    expect(await lint("no-silent-catch", `
      try { run(); } catch {
        try { risky(); } catch { }
      }
    `, options)).toHaveLength(2);
  });

  it("accepts a finalizer that always throws and rejects cleanup-only or conditional finalizers", async () => {
    expect(await lint("no-silent-catch", `
      async function validate(existingConnection: unknown, connection: { disconnect(): Promise<void> }, generation: number, fence: { assertCurrent(g: number): void }) {
        try { fence.assertCurrent(generation); } catch (error) {
          if (!existingConnection) {
            try { await connection.disconnect(); } finally { throw error; }
          }
          throw error;
        }
      }
      function dispose(error: unknown) {
        try { run(); } catch (error) {
          try { risky(); } finally { throw error; }
        }
      }
    `, options)).toHaveLength(0);
    expect(await lint("no-silent-catch", `
      try { run(); } catch {
        try { risky(); } finally { cleanup(); }
      }
    `, options)).toHaveLength(1);
    expect(await lint("no-silent-catch", `
      try { run(); } catch (error) {
        try { risky(); } finally { if (condition) throw error; }
      }
    `, options)).toHaveLength(1);
  });

  it("accepts reporting and helper calls behind a TypeScript-wrapped callee", async () => {
    expect(await lint("no-silent-catch", `
      import { reportClientError } from "@/client/observability/client-reporter";
      try { run(); } catch (error) { (reportClientError as (caught: unknown) => void)(error); }
      run().catch((error) => { (reportClientError as (caught: unknown) => void)(error); });
      function dispose(error: unknown): never { throw error; }
      try { run(); } catch (error) { (dispose as (caught: unknown) => never)(error); }
      run().catch((error) => { (dispose as (caught: unknown) => never)(error); });
    `, options)).toHaveLength(0);
  });

  it("accepts collection cleanup and void-wrapped reporting calls", async () => {
    expect(await lint("no-silent-catch", `
      import { reportClientError } from "@/client/observability/client-reporter";
      try { run(); } catch { pending.delete(key); }
      try { run(); } catch (error) { void reportClientError(error); }
    `, options)).toHaveLength(0);
  });

  it("rejects a local declaration shadowing an approved reporting helper", async () => {
    expect(await lint("no-silent-catch", `
      function observeSafely(x: unknown): void {}
      try { run(); } catch (error) { observeSafely(error); }
    `, options)).toHaveLength(1);
  });

  it("rejects an alias of a non-approved reporting export", async () => {
    expect(await lint("no-silent-catch", `
      import { buildClientErrorReport as reportClientError } from "@/client/observability/client-reporter";
      try { run(); } catch (error) { reportClientError(error); }
    `, options)).toHaveLength(1);
  });

  it("rejects a parameter shadowing a throwing same-file helper", async () => {
    expect(await lint("no-silent-catch", `
      function observeSafely(x: unknown): never { throw x; }
      function handle(observeSafely: (x: unknown) => void): void {
        try { run(); } catch (error) { observeSafely(error); }
      }
    `, options)).toHaveLength(1);
  });

  it("accepts a throwing same-file helper shadowing a same-name no-op helper", async () => {
    expect(await lint("no-silent-catch", `
      function reportFailure(): void {}
      function handle(): void {
        function reportFailure(): never { throw new Error("failed"); }
        try { run(); } catch { reportFailure(); }
      }
    `, options)).toHaveLength(0);
  });

  it("accepts approved aliases wrapping an injected telemetry sink", async () => {
    expect(await lint("no-silent-catch", `
      import { observeSafely as reportTelemetry } from "@/server/observability/log";
      function reportSafely(log: (error: unknown) => void, error: unknown): void { reportTelemetry(() => log(error)); }
      function handle() { try { run(); } catch (error) { reportSafely(log, error); } }
    `, options)).toHaveLength(0);
  });

  it("rejects an object method named like an approved reporting helper", async () => {
    expect(await lint("no-silent-catch", `
      try { run(); } catch (error) { sink.observeSafely(error); }
    `, options)).toHaveLength(1);
  });

  it("rejects a reporting helper imported from an unapproved module", async () => {
    expect(await lint("no-silent-catch", `
      import { observeSafely } from "./local-sink";
      try { run(); } catch (error) { observeSafely(error); }
    `, options)).toHaveLength(1);
  });

  it("accepts a directly imported wrapper around a real noncritical telemetry sink", async () => {
    expect(await lint("no-silent-catch", `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      try { run(); } catch (error) { observeSafely(() => emitServerEvent("failure", { code: String(error) })); }
      function reportSafely(log: (event: object) => unknown) { observeSafely(() => log({ outcome: "unavailable" })); }
      function reportReturn(log: (error: unknown) => void) { observeSafely(() => { return log(error); }); }
      function reportAwait(log: (error: unknown) => Promise<void>) { observeSafely(async () => { await log(error); }); }
      function reportAsserted(log: (error: unknown) => unknown) { observeSafely(async () => { await (log(error) as unknown); }); }
      function reportNested(log: (error: unknown) => void) { observeSafely(() => { observeSafely(() => log(error)); }); }
      function handle() {
        try { run(); } catch (error) { reportSafely(log); }
        try { run(); } catch (error) { reportReturn(log); }
        try { run(); } catch (error) { reportAwait(log); }
        try { run(); } catch (error) { reportAsserted(log); }
        try { run(); } catch (error) { reportNested(log); }
      }
    `, options)).toHaveLength(0);
  });

  it("accepts returned conditional, sequence and helper telemetry writes", async () => {
    expect(await lint("no-silent-catch", `
      import { observeSafely } from "@/server/observability/log";
      function reportConditional(log: (error: unknown) => Promise<void>, condition: boolean) { observeSafely(() => (condition ? log(error) : log(error))); }
      function reportSequence(log: (error: unknown) => Promise<void>, work: () => void) { observeSafely(() => (work(), log(error))); }
      function reportLogical(log: (error: unknown) => Promise<void>) { observeSafely(() => log(error) || undefined); }
      function reportNullish(log: (error: unknown) => Promise<void>) { observeSafely(async () => { await (log(error) ?? undefined); }); }
      function reportHelper(log: (error: unknown) => Promise<void>) { observeSafely(() => { function helper() { return log(error); } return helper(); }); }
      function handle() {
        try { run(); } catch (error) { reportConditional(log, condition); }
        try { run(); } catch (error) { reportSequence(log, work); }
        try { run(); } catch (error) { reportLogical(log); }
        try { run(); } catch (error) { reportNullish(log); }
        try { run(); } catch (error) { reportHelper(log); }
      }
    `, options)).toHaveLength(0);
  });

  it("rejects telemetry sinks whose injected parameter is reassigned", async () => {
    const diagnostics = await lint("no-silent-catch", `
      import { observeSafely } from "@/server/observability/log";
      function reassigned(log: (error: unknown) => void) {
        observeSafely(() => { log = () => {}; return log(error); });
      }
      function conditional(log: (error: unknown) => void, useFallback: boolean) {
        observeSafely(() => { if (useFallback) log = () => {}; return log(error); });
      }
      function defaulted(log: (error: unknown) => void = () => {}) {
        observeSafely(() => log(error));
      }
      function handle() {
        try { run(); } catch (error) { reassigned(log); }
        try { run(); } catch (error) { conditional(log, flag); }
        try { run(); } catch (error) { defaulted(log); }
      }
    `, options);
    expect(diagnostics).toHaveLength(3);
    for (const diagnostic of diagnostics) expect(diagnostic.message).toBe(messages.silent);
  });

  it("accepts a finalizer that always reports and rejects non-disposing finalizers", async () => {
    expect(await lint("no-silent-catch", `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      import { reportClientError } from "@/client/observability/client-reporter";
      function handle() {
        try { run(); } catch (error) {
          try { risky(); } finally { reportClientError(error); }
        }
        run().catch((error) => {
          try { risky(); } finally { reportClientError(error); }
        });
        try { run(); } catch (error) {
          try { throw error; } finally { emitServerEvent("x", { code: String(error) }); }
        }
        try { run(); } catch (error) {
          observeSafely(() => { try { risky(); } finally { return emitServerEvent("x", { code: String(error) }); } });
        }
        try { run(); } catch (error) {
          observeSafely(async () => { try { await risky(); } finally { await emitServerEvent("x", { code: String(error) }); } });
        }
      }
    `, options)).toHaveLength(0);
    const diagnostics = await lint("no-silent-catch", `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      function handle() {
        try { run(); } catch (error) {
          observeSafely(() => { try { risky(); } finally { emitServerEvent("x", { code: String(error) }); } });
        }
        try { run(); } catch (error) {
          observeSafely(() => { try { risky(); } finally { if (condition) return emitServerEvent("x", {}); } });
        }
        try { run(); } catch (error) {
          try { risky(); } finally { cleanup(); }
        }
      }
    `, options);
    expect(diagnostics).toHaveLength(3);
    for (const diagnostic of diagnostics) expect(diagnostic.message).toBe(messages.silent);
  });

  it("rejects generator rejection callbacks and yielding arms", async () => {
    const diagnostics = await lint("no-silent-catch", `
      import { reportClientError } from "@/client/observability/client-reporter";
      function* handle() {
        try { run(); } catch (error) { try { yield 1; } finally { reportClientError(error); } }
      }
      run().catch(function* (error) { try { risky(); } finally { reportClientError(error); } });
      run().then(ok, function* (error) { try { risky(); } finally { reportClientError(error); } });
    `, options);
    expect(diagnostics).toHaveLength(3);
    for (const diagnostic of diagnostics) expect(diagnostic.message).toBe(messages.silent);
    expect(await lint("no-silent-catch", `
      import { reportClientError } from "@/client/observability/client-reporter";
      function handle() { try { run(); } catch (error) { try { risky(); } finally { reportClientError(error); } } }
      run().catch((error) => { try { risky(); } finally { reportClientError(error); } });
    `, options)).toHaveLength(0);
  });

  it("rejects a finalizer that declares a resource before reporting", async () => {
    const diagnostics = await lint("no-silent-catch", `
      import { observeSafely } from "@/server/observability/log";
      import { reportClientError } from "@/client/observability/client-reporter";
      function report(error: unknown) {
        observeSafely(async () => { try { risky(); } finally { { await using r = asyncResource; } await reportClientError(error); } });
      }
      function reportSync(error: unknown) {
        observeSafely(async () => { try { risky(); } finally { { using r = resource; } await reportClientError(error); } });
      }
      function handle() {
        try { run(); } catch (error) { report(error); }
        try { run(); } catch (error) { reportSync(error); }
      }
    `, options);
    expect(diagnostics).toHaveLength(2);
    for (const diagnostic of diagnostics) expect(diagnostic.message).toBe(messages.silent);
    expect(await lint("no-silent-catch", `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      import { reportClientError } from "@/client/observability/client-reporter";
      function report(error: unknown) {
        observeSafely(async () => { try { risky(); } finally { await using r = asyncResource; await reportClientError(error); } });
      }
      function reportSync(error: unknown) {
        observeSafely(async () => { try { risky(); } finally { using r = resource; await reportClientError(error); } });
      }
      function handle() {
        try { run(); } catch (error) { report(error); }
        try { run(); } catch (error) { reportSync(error); }
        try { run(); } catch (error) {
          observeSafely(async () => {
            try { return await emitServerEvent("x", {}); } catch { return await emitServerEvent("x", {}); } finally { await using disposable = asyncResource; void disposable; }
          });
        }
      }
    `, options)).toHaveLength(0);
  });

  it("rejects generator dispositions that never report", async () => {
    const diagnostics = await lint("no-silent-catch", `
      import { observeSafely } from "@/server/observability/log";
      import { reportClientError } from "@/client/observability/client-reporter";
      function* reporting() { reportClientError("failed"); }
      function plainReporting() { reportClientError("failed"); }
      function handle() {
        try { run(); } catch (error) { try { risky(); } finally { reporting(); } }
        try { run(); } catch (error) { try { risky(); } finally { observeSafely(function* () { return reportClientError(error); }); } }
        try { run(); } catch (error) { try { risky(); } finally { observeSafely(async function* () { return reportClientError(error); }); } }
      }
    `, options);
    expect(diagnostics).toHaveLength(3);
    for (const diagnostic of diagnostics) expect(diagnostic.message).toBe(messages.silent);
    expect(await lint("no-silent-catch", `
      import { reportClientError } from "@/client/observability/client-reporter";
      function* reporting() { reportClientError("failed"); }
      function plainReporting() { reportClientError("failed"); }
      function handle() { try { run(); } catch (error) { try { risky(); } finally { plainReporting(); } } }
    `, options)).toHaveLength(0);
  });

  it("applies the abrupt-completion guard to concise bodies", async () => {
    const diagnostics = await lint("no-silent-catch", `
      import { observeSafely } from "@/server/observability/log";
      import { reportClientError } from "@/client/observability/client-reporter";
      const conciseHelper = (error: unknown) => reportClientError(class { static { throw error; } });
      function handle() {
        try { run(); } catch (error) { try { risky(); } finally { observeSafely(() => reportClientError(class { static { throw error; } })); } }
        try { run(); } catch (error) { try { risky(); } finally { conciseHelper(error); } }
      }
    `, options);
    expect(diagnostics).toHaveLength(2);
    for (const diagnostic of diagnostics) expect(diagnostic.message).toBe(messages.silent);
    expect(await lint("no-silent-catch", `
      import { observeSafely } from "@/server/observability/log";
      import { reportClientError } from "@/client/observability/client-reporter";
      const conciseHelper = (error: unknown) => reportClientError(error);
      function handle() {
        try { run(); } catch (error) { try { risky(); } finally { observeSafely(() => reportClientError(error)); } }
        try { run(); } catch (error) { try { risky(); } finally { conciseHelper(error); } }
      }
    `, options)).toHaveLength(0);
  });

  it("rejects a finalizer whose report a conditional jump can skip", async () => {
    const diagnostics = await lint("no-silent-catch", `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      import { reportClientError } from "@/client/observability/client-reporter";
      function handle() {
        try { run(); } catch (error) {
          try { risky(); } finally { do { if (flag) break; reportClientError(error); } while (false); }
        }
        try { run(); } catch (error) {
          observeSafely(async () => { try { risky(); } finally { do { if (flag) break; await emitServerEvent("x", {}); } while (false); } });
        }
        try { run(); } catch (error) {
          try { risky(); } finally { outer: do { if (flag) break outer; reportClientError(error); } while (false); }
        }
      }
    `, options);
    expect(diagnostics).toHaveLength(3);
    for (const diagnostic of diagnostics) expect(diagnostic.message).toBe(messages.silent);
  });

  it("rejects a finalizer whose report an unsupported exit can skip", async () => {
    const diagnostics = await lint("no-silent-catch", `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      import { reportClientError } from "@/client/observability/client-reporter";
      function handle() {
        try { run(); } catch (error) {
          try { risky(); } finally { switch (flag) { case true: return; } reportClientError(error); }
        }
        try { run(); } catch (error) {
          try { risky(); } finally { while (condition) { if (flag) return; } reportClientError(error); }
        }
        try { run(); } catch (error) {
          try { risky(); } finally { for (const item of items) { if (flag) return; } reportClientError(error); }
        }
        try { run(); } catch (error) {
          observeSafely(async () => { try { risky(); } finally { while (condition) { if (flag) return; } await emitServerEvent("x", {}); } });
        }
      }
    `, options);
    expect(diagnostics).toHaveLength(4);
    for (const diagnostic of diagnostics) expect(diagnostic.message).toBe(messages.silent);
  });

  it("rejects a finalizer whose report a yield can skip", async () => {
    const diagnostics = await lint("no-silent-catch", `
      import { reportClientError } from "@/client/observability/client-reporter";
      function* first() {
        try { run(); } catch (error) {
          try { risky(); } finally { yield; reportClientError(error); }
        }
      }
      function* second() {
        try { run(); } catch (error) {
          try { risky(); } finally { const pending = yield; reportClientError(pending); }
        }
      }
    `, options);
    expect(diagnostics).toHaveLength(2);
    for (const diagnostic of diagnostics) expect(diagnostic.message).toBe(messages.silent);
    expect(await lint("no-silent-catch", `
      import { reportClientError } from "@/client/observability/client-reporter";
      function* third() { try { run(); } catch (error) { try { risky(); } finally { reportClientError(error); } } }
    `, options)).toHaveLength(0);
  });

  it("rejects a finalizer whose report an executed class body can skip", async () => {
    const diagnostics = await lint("no-silent-catch", `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      import { reportClientError } from "@/client/observability/client-reporter";
      function handle() {
        try { run(); } catch (error) {
          observeSafely(async () => { try { risky(); } finally { const C = class { static { throw error; } }; await emitServerEvent("x", {}); } });
        }
        try { run(); } catch (error) {
          try { risky(); } finally { const C = class { static { throw error; } }; reportClientError(error); }
        }
        try { run(); } catch (error) {
          try { risky(); } finally { (class { static { throw error; } }); reportClientError(error); }
        }
      }
    `, options);
    expect(diagnostics).toHaveLength(3);
    for (const diagnostic of diagnostics) expect(diagnostic.message).toBe(messages.silent);
    expect(await lint("no-silent-catch", `
      import { reportClientError } from "@/client/observability/client-reporter";
      function handle() {
        try { run(); } catch (error) {
          try { risky(); } finally { const line = build(); reportClientError(line); }
        }
        try { run(); } catch (error) {
          try { risky(); } finally { const f = () => class { static { throw error; } }; reportClientError(error); }
        }
      }
    `, options)).toHaveLength(0);
  });

  it("documents the loop-local jump bound", async () => {
    const diagnostics = await lint("no-silent-catch", `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      import { reportClientError } from "@/client/observability/client-reporter";
      function handle() {
        try { run(); } catch (error) {
          try { risky(); } finally { do { if (flag) break; } while (false); reportClientError(error); }
        }
        try { run(); } catch (error) {
          try { risky(); } finally { do { reportClientError(error); } while (false); }
        }
      }
    `, options);
    expect(diagnostics).toHaveLength(1);
    for (const diagnostic of diagnostics) expect(diagnostic.message).toBe(messages.silent);
  });

  it("accepts a nested finalizer that reports on every path", async () => {
    expect(await lint("no-silent-catch", `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      import { reportClientError } from "@/client/observability/client-reporter";
      function handle() {
        try { run(); } catch (error) {
          try { risky(); } finally { try { risky(); } finally { reportClientError(error); } }
        }
        try { run(); } catch (error) {
          try { risky(); } finally { try { risky(); } finally { try { risky(); } finally { reportClientError(error); } } }
        }
        try { run(); } catch {
          do { if (flag) break; } while (false);
          reportClientError(error);
        }
        run().catch(() => {
          do { if (flag) break; } while (false);
          reportClientError(error);
        });
      }
    `, options)).toHaveLength(0);
  });

  for (const { name, body, expected } of [
    {
      name: "rejects returned telemetry overridden by a returning finalizer",
      body: 'try { return emitServerEvent("x", { code: String(error) }); } catch { return emitServerEvent("x", { code: String(error) }); } finally { return emitServerEvent("x", {}); }',
      expected: 1,
    },
    {
      name: "rejects returned telemetry delayed by an awaiting finalizer",
      body: 'try { return emitServerEvent("x", { code: String(error) }); } catch { return emitServerEvent("x", { code: String(error) }); } finally { await cleanup; }',
      expected: 1,
    },
    {
      name: "rejects returned telemetry delayed by a for-await finalizer",
      body: 'try { return emitServerEvent("x", { code: String(error) }); } catch { return emitServerEvent("x", { code: String(error) }); } finally { for await (const item of cleanupItems) { pending.delete(item); } }',
      expected: 1,
    },
    {
      name: "rejects returned telemetry overridden by an escaping labeled break in a finalizer",
      body: 'exit: { try { return emitServerEvent("x", { code: String(error) }); } catch { return emitServerEvent("x", { code: String(error) }); } finally { break exit; } }',
      expected: 1,
    },
    {
      name: "rejects returned telemetry overridden by an escaping continue in a finalizer",
      body: 'outer: do { try { return emitServerEvent("x", { code: String(error) }); } catch { return emitServerEvent("x", { code: String(error) }); } finally { continue outer; } } while (false);',
      expected: 1,
    },
    {
      name: "rejects returned telemetry discarded by a throw nested in a finalizer loop",
      body: 'try { return emitServerEvent("x", { code: String(error) }); } catch { return emitServerEvent("x", { code: String(error) }); } finally { while (condition) { throw new Error("cleanup"); } }',
      expected: 1,
    },
    {
      name: "rejects returned telemetry discarded by a throw in a finalizer static block",
      body: 'try { return emitServerEvent("x", { code: String(error) }); } catch { return emitServerEvent("x", { code: String(error) }); } finally { class Nested { static { throw new Error("cleanup"); } } }',
      expected: 1,
    },
    {
      name: "rejects returned telemetry discarded by a finalizer using declaration",
      body: 'try { return emitServerEvent("x", { code: String(error) }); } catch { return emitServerEvent("x", { code: String(error) }); } finally { using disposable = resource; void disposable; }',
      expected: 1,
    },
    {
      name: "rejects returned telemetry discarded by a finalizer await-using declaration",
      body: 'try { return emitServerEvent("x", { code: String(error) }); } catch { return emitServerEvent("x", { code: String(error) }); } finally { await using disposable = asyncResource; void disposable; }',
      expected: 1,
    },
    {
      name: "accepts awaited telemetry with a finalizer await-using declaration",
      body: 'try { return await emitServerEvent("x", { code: String(error) }); } catch { return await emitServerEvent("x", { code: String(error) }); } finally { await using disposable = asyncResource; void disposable; }',
      expected: 0,
    },
    {
      name: "accepts return-await telemetry with a returning finalizer",
      body: 'try { return await emitServerEvent("x", { code: String(error) }); } catch { return await emitServerEvent("x", { code: String(error) }); } finally { return emitServerEvent("x", {}); }',
      expected: 0,
    },
    {
      name: "accepts return-await telemetry with an awaiting finalizer",
      body: 'try { return await emitServerEvent("x", { code: String(error) }); } catch { return await emitServerEvent("x", { code: String(error) }); } finally { await cleanup; }',
      expected: 0,
    },
    {
      name: "accepts awaited telemetry with a returning finalizer",
      body: 'try { await emitServerEvent("x", { code: String(error) }); } catch { return await emitServerEvent("x", { code: String(error) }); } finally { return emitServerEvent("x", {}); }',
      expected: 0,
    },
    {
      name: "accepts awaited telemetry with an awaiting finalizer",
      body: 'try { await emitServerEvent("x", { code: String(error) }); } catch { return await emitServerEvent("x", { code: String(error) }); } finally { await cleanup; }',
      expected: 0,
    },
    {
      name: "accepts returned telemetry with a synchronous-only finalizer",
      body: 'try { return emitServerEvent("x", { code: String(error) }); } catch { return emitServerEvent("x", { code: String(error) }); } finally { pending.delete(key); }',
      expected: 0,
    },
    {
      name: "accepts telemetry returned from the finalizer itself",
      body: 'try { await emitServerEvent("x", { code: String(error) }); } catch { return await emitServerEvent("x", { code: String(error) }); } finally { return emitServerEvent("x", { code: String(error) }); }',
      expected: 0,
    },
    {
      name: "ignores return and await inside a finalizer's nested function",
      body: 'try { return emitServerEvent("x", { code: String(error) }); } catch { return emitServerEvent("x", { code: String(error) }); } finally { async function nested() { return await cleanup; } }',
      expected: 0,
    },
    {
      name: "ignores return and await inside a finalizer's nested arrow",
      body: 'try { return emitServerEvent("x", { code: String(error) }); } catch { return emitServerEvent("x", { code: String(error) }); } finally { const nested = async () => { return await cleanup; }; }',
      expected: 0,
    },
    {
      name: "ignores return and await inside a finalizer's object method",
      body: 'try { return emitServerEvent("x", { code: String(error) }); } catch { return emitServerEvent("x", { code: String(error) }); } finally { const nested = { async method() { return await cleanup; } }; }',
      expected: 0,
    },
    {
      name: "ignores return and await inside a finalizer's class declaration",
      body: 'try { return emitServerEvent("x", { code: String(error) }); } catch { return emitServerEvent("x", { code: String(error) }); } finally { class Nested { async method() { return await cleanup; } } }',
      expected: 0,
    },
    {
      name: "rejects returned telemetry delayed by await in a finalizer's class heritage",
      body: 'try { return emitServerEvent("x", { code: String(error) }); } catch { return emitServerEvent("x", { code: String(error) }); } finally { class Nested extends (await cleanupBase) {} }',
      expected: 1,
    },
    {
      name: "rejects returned telemetry delayed by await in a finalizer's computed method key",
      body: 'try { return emitServerEvent("x", { code: String(error) }); } catch { return emitServerEvent("x", { code: String(error) }); } finally { class Nested { [await cleanupKey]() {} } }',
      expected: 1,
    },
    {
      name: "rejects returned telemetry delayed by await in a finalizer's computed static field key",
      body: 'try { return emitServerEvent("x", { code: String(error) }); } catch { return emitServerEvent("x", { code: String(error) }); } finally { class Nested { static [await cleanupKey] = 1; } }',
      expected: 1,
    },
    {
      name: "rejects returned telemetry delayed by await in a finalizer's computed instance field key",
      body: 'try { return emitServerEvent("x", { code: String(error) }); } catch { return emitServerEvent("x", { code: String(error) }); } finally { class Nested { [await cleanupKey] = 1; } }',
      expected: 1,
    },
    {
      name: "ignores return and await inside a finalizer's class expression",
      body: 'try { return emitServerEvent("x", { code: String(error) }); } catch { return emitServerEvent("x", { code: String(error) }); } finally { const Nested = class { async method() { return await cleanup; } }; }',
      expected: 0,
    },
    {
      name: "ignores an awaiting finalizer whose try does not enclose the return",
      body: 'try { work(); } catch { pending.delete(key); } finally { await cleanup; } return emitServerEvent("x", { code: String(error) });',
      expected: 0,
    },
    {
      name: "rejects telemetry returned from a finalizer before an interrupting outer finalizer",
      body: 'try { try { await emitServerEvent("x", { code: String(error) }); } catch { return await emitServerEvent("x", { code: String(error) }); } finally { return emitServerEvent("x", { code: String(error) }); } } catch { return emitServerEvent("x", { code: String(error) }); } finally { await cleanup; }',
      expected: 1,
    },
    {
      name: "rejects returned helper telemetry overridden by a finalizer",
      body: 'function helper() { return emitServerEvent("x", { code: String(error) }); } try { return helper(); } catch { return helper(); } finally { return emitServerEvent("x", {}); }',
      expected: 1,
    },
  ]) {
    it(name, async () => {
      expect(await lint("no-silent-catch", `
        import { observeSafely, emitServerEvent } from "@/server/observability/log";
        async function report(cleanup: Promise<void>) {
          try { run(); } catch (error) { observeSafely(async () => { ${body} }); } finally { await cleanup; }
        }
      `, options)).toHaveLength(expected);
    });
  }

  it("rejects a returned telemetry write discarded by a same-scope using declaration", async () => {
    const diagnostics = await lint("no-silent-catch", `
      import { observeSafely } from "@/server/observability/log";
      function report(log: (error: unknown) => Promise<unknown>) {
        observeSafely(async () => { try { risky(); } finally { using r = resource; return log(error); } });
      }
      function reportAsync(log: (error: unknown) => Promise<unknown>) {
        observeSafely(async () => { try { risky(); } finally { await using r = asyncResource; return log(error); } });
      }
      function handle() {
        try { run(); } catch (error) { report(log); }
        try { run(); } catch (error) { reportAsync(log); }
      }
    `, options);
    expect(diagnostics).toHaveLength(2);
    for (const diagnostic of diagnostics) expect(diagnostic.message).toBe(messages.silent);
    expect(await lint("no-silent-catch", `
      import { observeSafely } from "@/server/observability/log";
      function report(log: (error: unknown) => Promise<unknown>) {
        observeSafely(async () => { try { risky(); } finally { using r = resource; return await log(error); } });
      }
      function handle() { try { run(); } catch (error) { report(log); } }
    `, options)).toHaveLength(0);
  });

  it("rejects discarded telemetry sink calls inside observeSafely callbacks", async () => {
    expect(await lint("no-silent-catch", `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      try { run(); } catch (error) { observeSafely(() => { emitServerEvent("x", { code: String(error) }); }); }
    `, options)).toHaveLength(1);
    expect(await lint("no-silent-catch", `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      try { run(); } catch (error) { observeSafely(() => { void emitServerEvent("x", { code: String(error) }); }); }
    `, options)).toHaveLength(1);
    expect(await lint("no-silent-catch", `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      try { run(); } catch (error) { observeSafely(() => { if (condition) emitServerEvent("x", { code: String(error) }); else return emitServerEvent("x", { code: String(error) }); }); }
    `, options)).toHaveLength(1);
    expect(await lint("no-silent-catch", `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      try { run(); } catch (error) { observeSafely(() => { emitServerEvent("x", {}); }); }
    `, options)).toHaveLength(1);
    expect(await lint("no-silent-catch", `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      try { run(); } catch (error) { observeSafely(() => { const pending = emitServerEvent("x", { code: String(error) }); }); }
    `, options)).toHaveLength(1);
    expect(await lint("no-silent-catch", `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      try { run(); } catch (error) { observeSafely(() => { condition ? emitServerEvent("x", { code: String(error) }) : emitServerEvent("x", { code: String(error) }); }); }
    `, options)).toHaveLength(1);
    expect(await lint("no-silent-catch", `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      try { run(); } catch (error) { observeSafely(() => { queue.push(emitServerEvent("x", { code: String(error) })); }); }
    `, options)).toHaveLength(1);
    expect(await lint("no-silent-catch", `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      try { run(); } catch (error) { observeSafely(() => { return [emitServerEvent("x", { code: String(error) })]; }); }
    `, options)).toHaveLength(1);
    expect(await lint("no-silent-catch", `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      try { run(); } catch (error) { observeSafely(async () => { await [emitServerEvent("x", { code: String(error) })]; }); }
    `, options)).toHaveLength(1);
    expect(await lint("no-silent-catch", `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      try { run(); } catch (error) { observeSafely(() => { if (emitServerEvent("x", { code: String(error) })) { work(); } }); }
    `, options)).toHaveLength(1);
    expect(await lint("no-silent-catch", `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      try { run(); } catch (error) { observeSafely(() => { function helper() { return emitServerEvent("x", { code: String(error) }); } helper(); }); }
    `, options)).toHaveLength(1);
  });

  it("accepts approved reporting imports and a directly injected sink in telemetry callbacks", async () => {
    expect(await lint("no-silent-catch", `
      import { observeSafely, emitServerEvent as emit, writeObservabilityEvent } from "@/server/observability/log";
      import { reportClientError as send } from "@/client/observability/client-reporter";
      function reportSafely(sink: (failure: unknown) => void, error: unknown): void { observeSafely(() => sink(error)); }
      function report() {
        try { run(); } catch (error) { reportSafely(sink, error); }
        try { run(); } catch (error) { observeSafely(() => emit("failure", { code: String(error) })); }
        try { run(); } catch (error) { observeSafely(() => writeObservabilityEvent({ code: String(error) })); }
        try { run(); } catch (error) { observeSafely(() => send({ name: "Failure", message: String(error), route: "/" })); }
      }
    `, options)).toHaveLength(0);
  });

  it("rejects wrappers whose callbacks return or discard a failure without reporting it", async () => {
    expect(await lint("no-silent-catch", `
      import { observeSafely as reportTelemetry, emitServerEvent } from "@/server/observability/log";
      try { run(); } catch (error) { reportTelemetry(() => error); }
      try { run(); } catch (error) { reportTelemetry(() => { void error; }); }
      try { run(); } catch (error) { reportTelemetry(() => undefined); }
      try { run(); } catch (error) { reportTelemetry(() => { throw error; }); }
      try { run(); } catch (error) { reportTelemetry(() => console.log(error)); }
      let status = "ready";
      try { run(); } catch (error) { reportTelemetry(() => { status = "failed"; }); }
      consume(status);
      try { run(); } catch (error) { reportTelemetry(() => { try { work(); } finally { throw error; } }); }
      try { run(); } catch (error) { reportTelemetry(() => { if (condition) emitServerEvent("x", { code: String(error) }); }); }
    `, options)).toHaveLength(8);
  });

  it("accepts an injected sink declared by a delegation wrapper reached from a catch", async () => {
    expect(await lint("no-silent-catch", `
      import { observeSafely } from "@/server/observability/log";
      function reportSubscriptionFailureSafely(log: (reason: string) => void, reason: string): void { observeSafely(() => log(reason)); }
      async function ensureAddressSubscribed(address: string) {
        try { await ensure(address); } catch (error) { reportSubscriptionFailureSafely(logFailure, error instanceof Error ? error.message : "subscription-failed"); }
      }
    `, options)).toHaveLength(0);
  });

  it("rejects an injected callback used as a sink outside a delegation wrapper", async () => {
    expect(await lint("no-silent-catch", `
      import { observeSafely } from "@/server/observability/log";
      async function handle(load: () => Promise<void>, persistFailure: (error: unknown) => Promise<void>) {
        try { await load(); } catch (error) { observeSafely(() => persistFailure(error)); }
      }
      function handleOther(log: (event: object) => unknown) {
        try { run(); } catch { observeSafely(() => log({ outcome: "unavailable" })); }
      }
    `, options)).toHaveLength(2);
  });

  it("rejects a delegation wrapper whose body does other work", async () => {
    expect(await lint("no-silent-catch", `
      import { observeSafely } from "@/server/observability/log";
      function reportSafely(log: (reason: string) => void, reason: string): void { setup(); observeSafely(() => log(reason)); }
      function handle() { try { run(); } catch (error) { reportSafely(log, String(error)); } }
    `, options)).toHaveLength(1);
  });

  it("rejects a delegation wrapper that hides the telemetry call behind other work", async () => {
    expect(await lint("no-silent-catch", `
      import { observeSafely } from "@/server/observability/log";
      function reportSequence(log: (error: unknown) => void, error: unknown): void { (setup(), observeSafely(() => log(error))); }
      const makeHandler = (persistence: (error: unknown) => void) => () => {
        try { run(); } catch (error) { observeSafely(() => persistence(error)); }
      };
      function handle() {
        try { run(); } catch (error) { reportSequence(log, error); }
      }
    `, options)).toHaveLength(2);
  });

  it("rejects an injected sink behind an inline rejection handler", async () => {
    expect(await lint("no-silent-catch", `
      import { observeSafely } from "@/server/observability/log";
      function handle(load: () => Promise<void>, persistFailure: (error: unknown) => Promise<void>) {
        return load().catch((error) => { observeSafely(() => persistFailure(error)); });
      }
    `, options)).toHaveLength(1);
  });

  it("accepts a concise arrow delegation wrapper", async () => {
    expect(await lint("no-silent-catch", `
      import { observeSafely } from "@/server/observability/log";
      const reportConcise = (log: (error: unknown) => void, error: unknown) => observeSafely(() => log(error));
      function handle() { try { run(); } catch (error) { reportConcise(log, error); } }
    `, options)).toHaveLength(0);
  });

  it("rejects a local no-op sink and inauthentic wrapper imports", async () => {
    expect(await lint("no-silent-catch", `
      import { observeSafely as approved } from "@/server/observability/log";
      import { observeSafely as foreign } from "./local-sink";
      import { buildClientErrorReport as disguised } from "@/client/observability/client-reporter";
      function noop(error: unknown): void {}
      function handle(log: (error: unknown) => void) {
        const approved = (callback: () => unknown) => callback();
        try { run(); } catch (error) { approved(() => log(error)); }
        try { run(); } catch (error) { foreign(() => log(error)); }
        try { run(); } catch (error) { disguised(() => log(error)); }
        try { run(); } catch (error) { observeSafely(() => log(error)); }
      }
      try { run(); } catch (error) { approved(() => noop(error)); }
    `, options)).toHaveLength(5);
  });

  it("rejects builders, arbitrary imports, aliases, and callback-local parameters as telemetry sinks", async () => {
    expect(await lint("no-silent-catch", `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      import { buildClientErrorReport as build } from "@/client/observability/client-reporter";
      import { sendReport } from "./unknown-reporter";
      function noop(_error: unknown): void {}
      function handle(sink: (error: unknown) => void) {
        const alias = sink;
        const ignored = noop;
        try { run(); } catch (error) { observeSafely(() => build({ name: "Failure", message: String(error), route: "/" })); }
        try { run(); } catch (error) { observeSafely(() => sendReport(error)); }
        try { run(); } catch (error) { observeSafely(() => alias(error)); }
        try { run(); } catch (error) { observeSafely(() => ignored(error)); }
        try { run(); } catch (error) { observeSafely((callbackSink: (error: unknown) => void) => callbackSink(error)); }
        try { run(); } catch { observeSafely(() => emitServerEvent()); }
        try { run(); } catch (error) { observeSafely((callbackSink: (error: unknown) => void) => observeSafely(() => callbackSink(error))); }
      }
    `, options)).toHaveLength(7);
  });

  it("rejects empty and non-disposing inline promise rejection handlers", async () => {
    const diagnostics = await lint("no-silent-catch", `
      run().catch(() => {});
      run().catch(function () {});
      run().catch(() => { /* intentionally empty */ });
      run().catch(() => { return; });
      run().then(ok, () => {});
      run()?.catch(() => {});
      run().then(ok, function () {});
      run().catch((error) => { console.log(error); });
      run()["catch"](() => {});
      run()["then"](ok, () => {});
      run()["catch"](() => { return; });
      run()[\`catch\`](() => {});
      run()["catch"]((error) => { console.log(error); });
      run()["catch"]?.(() => {});
    `, options);
    expect(diagnostics).toHaveLength(14);
    expect(diagnostics.filter((diagnostic) => diagnostic.message === messages.empty)).toHaveLength(10);
    expect(diagnostics.filter((diagnostic) => diagnostic.message === messages.silent)).toHaveLength(4);
  });

  it("rejects TypeScript-wrapped empty and non-disposing inline rejection handlers", async () => {
    const diagnostics = await lint("no-silent-catch", `
      run().catch((() => {}) as (error: unknown) => void);
      run().catch((() => {}) satisfies (error: unknown) => void);
      run().catch((() => {})!);
      run().catch(<(error: unknown) => void>(() => {}));
      run().then(ok, (() => {}) as (error: unknown) => void);
      run().catch(((error) => { console.log(error); }) as (error: unknown) => void);
      run()["catch"]((() => {}) as (error: unknown) => void);
    `, options);
    expect(diagnostics).toHaveLength(7);
    expect(diagnostics.filter((diagnostic) => diagnostic.message === messages.empty)).toHaveLength(6);
    expect(diagnostics.filter((diagnostic) => diagnostic.message === messages.silent)).toHaveLength(1);
  });

  it("leaves dynamic rejection method keys unclassified", async () => {
    expect(await lint("no-silent-catch", `
      run()[method](() => {});
      run()[\`cat\${suffix}\`](() => {});
      run()["cat" + "ch"](() => {});
    `, options)).toHaveLength(0);
  });

  it("accepts TypeScript-wrapped inline rejection dispositions", async () => {
    expect(await lint("no-silent-catch", `
      run().catch((() => []) as (error: unknown) => unknown);
      run().catch(((error) => { throw error; }) as (error: unknown) => never);
      run().catch((() => undefined) as (error: unknown) => undefined);
    `, options)).toHaveLength(0);
  });

  it("preserves cleanup exemptions through TypeScript-wrapped receivers", async () => {
    expect(await lint("no-silent-catch", `
      (reader.cancel() as Promise<void>).catch(() => {});
      (iterator.return?.() as Promise<void>).catch(() => {});
    `, options)).toHaveLength(0);
  });

  it("preserves retained-fallback parity through TypeScript-wrapped success callbacks and calls", async () => {
    const before = await lint("no-silent-catch", `
      async function read() {
        let details = fallback;
        await load().then(((value) => { details = value; }) as (value: string) => void).catch(() => {});
        return details;
      }
    `, options);
    expect(before).toHaveLength(0);
    const after = await lint("no-silent-catch", `
      async function read() {
        await load().then(((value) => { details = value; }) as (value: string) => void).catch(() => {});
        if (condition) { var details = fallback; }
        return details;
      }
    `, options);
    expect(after).toHaveLength(1);
    expect(after[0].message).toBe(messages.empty);
    expect(await lint("no-silent-catch", `
      async function read() {
        let details = fallback;
        await (run().then(((value) => { details = value; }) as (value: string) => void) as Promise<void>).catch(() => {});
        return details;
      }
    `, options)).toHaveLength(0);

    expect(await lint("no-silent-catch", `
      async function read() {
        let details = fallback;
        await (run()["then"](((value) => { details = value; }) as (value: string) => void) as Promise<void>).catch(() => {});
        return details;
      }
    `, options)).toHaveLength(0);
  });

  it("keeps neighbouring promise rejection classifications unchanged", async () => {
    for (const code of [
      "run().then(ok).catch(() => {});",
      "run().catch(() => {}).then(ok);",
      "run().catch?.(() => {});",
    ]) {
      const diagnostics = await lint("no-silent-catch", code, options);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).toBe(messages.empty);
    }
    expect(await lint("no-silent-catch", `
      run().catch(handler);
      other().catch(handler);
    `, options)).toHaveLength(0);
    const inline = await lint("no-silent-catch", `
      run().catch(() => {});
      other().catch(() => {});
    `, options);
    expect(inline).toHaveLength(2);
    expect(inline.filter((diagnostic) => diagnostic.message === messages.empty)).toHaveLength(2);
  });

  it("accepts explicit promise fallbacks, throws, reporting, recovery, and named handlers", async () => {
    expect(await lint("no-silent-catch", `
      import { reportClientError } from "@/client/observability/client-reporter";
      run().catch(() => []);
      run().catch(() => null);
      run()?.catch(() => undefined);
      run().catch(() => ({ ok: false }));
      run().catch((error) => { throw error; });
      run().catch((error) => { reportClientError(error); });
      run().then(ok, () => { setError("failed"); });
      run().catch(namedHandler);
      run()["catch"](() => []);
      run()["then"](ok, () => { setError("failed"); });
      run().then(ok, namedHandler);
      let status = "ready";
      run().catch(() => { status = "failed"; });
      consume(status);
    `, options)).toHaveLength(0);
  });

  it("exempts iterator and stream cancellation cleanup", async () => {
    expect(await lint("no-silent-catch", `
      reader.cancel().catch(() => {});
      reader["cancel"]().catch(() => {});
      request.body.cancel().catch(() => undefined);
      response.body?.cancel().catch(() => {});
      pendingReader.cancel().catch(() => {});
      iterator.return?.().catch(() => {});
      iterator.return?.().then(ok, () => {});
    `, options)).toHaveLength(0);
  });

  it("reports cleanup-named methods on receivers that are not streams or iterators", async () => {
    expect(await lint("no-silent-catch", `
      payment.cancel().catch(() => {});
      payment["cancel"]().catch(() => {});
      animations.step.cancel().catch((error) => {});
    `, options)).toHaveLength(3);
  });

  it("applies the same block disposition policy to try catches and promise rejections", async () => {
    for (const [body, expected, messageId] of [
      ["", 1, "empty"],
      ["return;", 1, "silent"],
      ["return [];", 0, null],
      ["throw error;", 0, null],
      ["reportClientError(error);", 0, null],
      ["setError('failed');", 0, null],
      ["console.log(error);", 1, "silent"],
    ]) {
      const catchDiagnostics = await lint("no-silent-catch",
        `import { reportClientError } from "@/client/observability/client-reporter"; async function read() { try { return await run(); } catch (error) { ${body} } }`, options);
      const promiseDiagnostics = await lint("no-silent-catch",
        `import { reportClientError } from "@/client/observability/client-reporter"; async function read() { return await run().catch((error) => { ${body} }); }`, options);
      expect(catchDiagnostics).toHaveLength(expected);
      expect(promiseDiagnostics).toHaveLength(catchDiagnostics.length);
      if (messageId) {
        expect(catchDiagnostics[0].message).toBe(messages[messageId]);
        expect(promiseDiagnostics[0].message).toBe(messages[messageId]);
      }
    }
  });

  it("keeps retained pre-initialized fallback parity across try and inline promise handlers", async () => {
    for (const { initializer, assignments, readAfter, expected } of [
      { initializer: "{ code: null }", assignments: "details = value;", readAfter: true, expected: 0 },
      { initializer: "undefined", assignments: "details = value;", readAfter: true, expected: 1 },
      { initializer: "{ code: null }", assignments: "details = value;", readAfter: false, expected: 1 },
      { initializer: "{ code: null }", assignments: "details = undefined; details = value;", readAfter: true, expected: 1 },
    ]) {
      const ending = readAfter ? "return details;" : "return null;";
      const tryDiagnostics = await lint("no-silent-catch", `
        async function read() {
          let details = ${initializer};
          try { ${assignments.replaceAll("value", "await load()")} } catch {}
          ${ending}
        }
      `, options);
      expect(tryDiagnostics).toHaveLength(expected);
      for (const promise of [
        `await load().then((value) => { ${assignments} }).catch(() => {});`,
        `await load().then((value) => { ${assignments} }, () => {});`,
      ]) {
        const promiseDiagnostics = await lint("no-silent-catch", `
          async function read() {
            let details = ${initializer};
            ${promise}
            ${ending}
          }
        `, options);
        expect(promiseDiagnostics).toHaveLength(expected);
        if (expected) {
          expect(tryDiagnostics[0].message).toBe(messages.empty);
          expect(promiseDiagnostics[0].message).toBe(messages.empty);
        }
      }
    }
  });

  it("requires the fallback declaration before the protected call and accepts concise success bodies", async () => {
    for (const promise of [
      "await load().then((value) => details = value).catch(() => {});",
      "await load().then((value) => details = value, () => {});",
    ]) {
      expect(await lint("no-silent-catch", `
        async function read() {
          let details = { code: null };
          ${promise}
          return details;
        }
      `, options)).toHaveLength(0);
      expect(await lint("no-silent-catch", `
        async function read() {
          ${promise}
          if (condition) { var details = { code: null }; }
          return details;
        }
      `, options)).toHaveLength(1);
    }
  });
});

describe("isolate-instrumentation-calls", () => {
  const options = { safeHelpers: ["emitServerEvent"] };

  it("accepts configured intrinsically safe helpers and isolated unsafe helpers", async () => {
    expect(await lint("isolate-instrumentation-calls", `
      import { emitServerEvent, reportClientError } from "@/server/observability/log";
      emitServerEvent(event);
      try { await reportClientError(event); } catch {}
      void reportClientError(event).catch(handleFailure);
      void reportClientError(event)["catch"](handleFailure);
    `, options)).toHaveLength(0);
  });

  it("rejects unsafe imported instrumentation calls that can escape", async () => {
    expect(await lint("isolate-instrumentation-calls", `
      import { reportClientError } from "@/server/observability/log";
      reportClientError(event);
      try { reportClientError(event); } catch {}
    `, options)).toHaveLength(2);
  });

  it("requires startup reports inside try blocks to be awaited", async () => {
    expect(await lint("isolate-instrumentation-calls", `
      import { sendHomeStartupReport } from "@/client/observability/client-reporter";
      try { sendHomeStartupReport(report); } catch {}
      try { await sendHomeStartupReport(report); } catch {}
    `, options)).toHaveLength(1);
  });
});
