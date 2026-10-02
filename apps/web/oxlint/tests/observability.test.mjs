import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { describe, expect, it } from "bun:test";
import { budgetMs, createOxlintWorkspace } from "./helpers/oxlint-workspace.mjs";
applyRuleCheckTimeout();

const { lint } = await createOxlintWorkspace("home-oxlint-observability-");

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
    const results = await lint({
      fixture1: `
      try { run(); } catch {}
      try { run(); } catch { /* intentionally empty */ }
      function read() { try { run(); } catch { return; } }
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(3);
  }, budgetMs);

  it("accepts throws, explicit return values, reporting, recovery state, and promise settlement", async () => {
    const results = await lint({
      fixture1: `
      import { emitServerEvent } from "@/server/observability/log";
      function a() { try { run(); } catch (error) { throw error; } }
      function b() { try { run(); } catch { return { ok: false }; } }
      function c() { try { run(); } catch { return null; } }
      function d() { try { run(); } catch { return undefined; } }
      try { run(); } catch (error) { emitServerEvent(error); }
      try { run(); } catch { setError("failed"); }
      try { run(); } catch { dispatch({ type: "failed" }); }
      try { run(); } catch (error) { reject(error); }
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);

  it("accepts any non-undefined outer recovery value when it is read after the catch", async () => {
    const results = await lint({
      fixture1: `
      let status = "ready";
      let count = 1;
      let details = { ready: true };
      try { run(); } catch { status = ""; }
      try { run(); } catch { count = 0; }
      try { run(); } catch { details = {}; }
      consume(status, count, details);
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);

  it("accepts a retained pre-initialized fallback assigned by the try", async () => {
    const results = await lint({
      fixture1: `
      let details = { code: null };
      try { details = readDetails(); } catch {}
      consume(details);
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);

  it("rejects undefined fallbacks, undefined reassignment, and late declarations", async () => {
    const results = await lint({
      fixture1: `
      let typed = undefined as { code: null } | undefined;
      try { typed = readDetails(); } catch {}
      consume(typed);
    `,
      fixture2: `
      let overwritten = { code: null };
      try { overwritten = undefined; overwritten = readDetails(); } catch {}
      consume(overwritten);
    `,
      fixture3: `
      try { hoisted = readDetails(); } catch {}
      if (condition) { var hoisted = { code: null }; }
      consume(hoisted);
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(1);
    expect(results.fixture2).toHaveLength(1);
    expect(results.fixture3).toHaveLength(1);
  }, budgetMs);

  it("rejects missing or undefined initializers and pre-initialized bindings not read after the try", async () => {
    const results = await lint({
      fixture1: `
      let missing;
      try { missing = readDetails(); } catch {}
      consume(missing);
      let undefinedFallback = undefined;
      try { undefinedFallback = readDetails(); } catch {}
      consume(undefinedFallback);
      let unread = { code: null };
      try { unread = readDetails(); } catch {}
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(3);
  }, budgetMs);

  it("rejects type-asserted undefined initializers and assignments", async () => {
    const results = await lint({
      fixture1: `
      let assertedFallback = <undefined>undefined;
      try { assertedFallback = readDetails(); } catch {}
      consume(assertedFallback);
      let asserted = "ready";
      try { run(); } catch { asserted = <undefined>undefined; }
      consume(asserted);
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(2);
  }, budgetMs);

  it("accepts primitive and empty-literal returns", async () => {
    const results = await lint({
      fixture1: `
      function zero() { try { run(); } catch { return 0; } }
      function blank() { try { run(); } catch { return ""; } }
      function no() { try { run(); } catch { return false; } }
      function object() { try { run(); } catch { return {}; } }
      function array() { try { run(); } catch { return []; } }
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);

  it("rejects outer assignments of undefined or values that are never read", async () => {
    const results = await lint({
      fixture1: `
      let result = "ready";
      try { run(); } catch { result = undefined; }
      consume(result);
      let unread = "ready";
      try { run(); } catch { unread = "failed"; }
      unread = "replaced";
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(2);
  }, budgetMs);

  it("rejects discards and dispositions that do not dominate the catch body", async () => {
    const results = await lint({
      fixture1: `
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
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(6);
  }, budgetMs);

  it("accepts dispositions that cover every catch path", async () => {
    const results = await lint({
      fixture1: `
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
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);

  it("accepts failures disposed by same-file helpers that throw or report", async () => {
    const results = await lint({
      fixture1: `
      import { emitServerEvent } from "@/server/observability/log";
      function unsupported(): never { throw new Error("unsupported"); }
      function unavailable(cause: unknown): never { throw new Error(String(cause)); }
      function observeStoreFailure(code: string): void { emitServerEvent(code); }
      try { run(); } catch { unsupported(); }
      try { run(); } catch (error) { unavailable(error); }
      try { run(); } catch (error) { if (error instanceof Error) throw error; unavailable(error); }
      try { run(); } catch { observeStoreFailure("failed"); }
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);

  it("rejects a no-op binding that shares a name with a throwing same-file helper", async () => {
    const results = await lint({
      fixture1: `
      function recordFailure(): never { throw new Error("failed"); }
      function handle(createNoop: () => () => void): void {
        const recordFailure = createNoop();
        try { run(); } catch { recordFailure(); }
      }
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(1);
  }, budgetMs);

  it("rejects same-file helpers that only return values or fall through", async () => {
    const results = await lint({
      fixture1: `
      function ignore(): null { return null; }
      function noop(): void { }
      try { run(); } catch { ignore(); }
      try { run(); } catch { noop(); }
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(2);
  }, budgetMs);

  it("accepts a nested retry that assigns state or returns on every path", async () => {
    const results = await lint({
      fixture1: `
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
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);

  it("rejects a nested try whose handler falls through", async () => {
    const results = await lint({
      fixture1: `
      try { run(); } catch {
        try { risky(); } catch { }
      }
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(2);
  }, budgetMs);

  it("accepts a finalizer that always throws and rejects cleanup-only or conditional finalizers", async () => {
    const results = await lint({
      fixture1: `
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
    `,
      fixture2: `
      try { run(); } catch {
        try { risky(); } finally { cleanup(); }
      }
    `,
      fixture3: `
      try { run(); } catch (error) {
        try { risky(); } finally { if (condition) throw error; }
      }
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(0);
    expect(results.fixture2).toHaveLength(1);
    expect(results.fixture3).toHaveLength(1);
  }, budgetMs);

  it("accepts reporting and helper calls behind a TypeScript-wrapped callee", async () => {
    const results = await lint({
      fixture1: `
      import { reportClientError } from "@/client/observability/client-reporter";
      try { run(); } catch (error) { (reportClientError as (caught: unknown) => void)(error); }
      run().catch((error) => { (reportClientError as (caught: unknown) => void)(error); });
      function dispose(error: unknown): never { throw error; }
      try { run(); } catch (error) { (dispose as (caught: unknown) => never)(error); }
      run().catch((error) => { (dispose as (caught: unknown) => never)(error); });
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);

  it("accepts collection cleanup and void-wrapped reporting calls", async () => {
    const results = await lint({
      fixture1: `
      import { reportClientError } from "@/client/observability/client-reporter";
      try { run(); } catch { pending.delete(key); }
      try { run(); } catch (error) { void reportClientError(error); }
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);

  it("accepts recovery-named calls bound to imports, hook results, promise executors, globals, and members", async () => {
    const results = await lint({
      fixture1: `
      import { useReducer, useState } from "react";
      import { resetCache as clearCache } from "@/client/cache";
      export async function Panel() {
        const [, setError] = useState("");
        const [, dispatch] = useReducer(reducer, initial);
        const reset = useReset();
        const { invalidate } = await loadClient();
        try { run(); } catch { setError("failed"); }
        try { run(); } catch { (dispatch as (action: unknown) => void)({ type: "failed" }); }
        try { run(); } catch { reset(); }
        try { run(); } catch { invalidate(); }
        try { run(); } catch { clearCache(); }
        run().catch(() => { setError("failed"); });
      }
      const settled = new Promise((resolve, reject) => {
        try { resolve(run()); } catch (error) { reject(error); }
      });
      try { run(); } catch { clearTimeout(timer); }
      try { run(); } catch { controller.abort(); }
      try { run(); } catch { pending.delete(key); }
      function clearState() { setStatus("idle"); }
      try { run(); } catch { clearState(); }
      const wrapped = new Promise(((resolve, reject) => {
        try { resolve(run()); } catch (error) { reject(error); }
      }) as (resolve: (value: unknown) => void, reject: (error: unknown) => void) => void);
      const resetState = (() => { throw new Error("failed"); }) as () => never;
      try { run(); } catch { resetState(); }
    `,
      fixture2: `
      type Promise = unknown;
      const typed = new Promise((resolve, reject) => {
        try { resolve(run()); } catch (error) { reject(error); }
      });
      function scheduled<clearTimeout>() {
        try { run(); } catch { clearTimeout(timer); }
      }
      function fail(code: string): never;
      function fail(code: number): never;
      function fail(code: string | number): never { throw new Error(String(code)); }
      try { run(); } catch { fail("E1"); }
      type recover = () => never;
      function recover(): never { throw new Error("failed"); }
      try { run(); } catch { recover(); }
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(0);
    expect(results.fixture2).toHaveLength(0);
  }, budgetMs);

  it("rejects recovery-named calls bound to parameters, local no-ops, and non-call bindings", async () => {
    const results = await lint({
      fixture1: `
      import { reportClientError as setReport } from "@/client/observability/client-reporter";
      function handle(setReport: (error: unknown) => void) {
        try { run(); } catch (error) { (setReport as Function)(error); }
      }
    `,
      fixture2: `
      function handle(onFailure: (error: unknown) => void, reject: (error: unknown) => void) {
        try { run(); } catch (error) { onFailure(error); }
        try { run(); } catch (error) { reject(error); }
        run().catch((error) => { onFailure(error); });
      }
    `,
      fixture3: `
      const setReport = (error: unknown) => {};
      function resetState() {}
      const clearState = () => { if (ready) return; };
      try { run(); } catch (error) { setReport(error); }
      try { run(); } catch { resetState(); }
      try { run(); } catch { clearState(); }
    `,
      fixture4: `
      const reset = noop;
      let setStatus = useStatus();
      setStatus = () => {};
      try { run(); } catch { reset(); }
      try { run(); } catch { setStatus("failed"); }
      try { run(); } catch (cancelError) { cancelError(); }
    `,
      fixture5: `
      var setError = useStatus();
      var setError = createNoop();
      try { run(); } catch (error) { setError(error); }
      new Promise((resolve, reject, setFailure = (error: unknown) => {}) => {
        try { resolve(run()); } catch (error) { setFailure(error); }
      });
      function shadowed(Promise: new (executor: (resolve: () => void, reject: (error: unknown) => void) => void) => unknown) {
        new Promise((resolve, reject) => { try { resolve(); } catch (error) { reject(error); } });
      }
    `,
      fixture6: `
      let recover = (() => { throw new Error("failed"); }) as () => void;
      recover = () => {};
      try { run(); } catch { recover(); }
      function fail(): never { throw new Error("failed"); }
      var fallback = fail;
      var fallback = () => {};
      try { run(); } catch { fallback(); }
      let fallthrough = () => { throw new Error("failed"); };
      fallthrough = () => {};
      try { run(); } catch { fallthrough(); }
      declare function reset(): void;
      try { run(); } catch { reset(); }
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(1);
    expect(results.fixture2).toHaveLength(3);
    expect(results.fixture3).toHaveLength(3);
    expect(results.fixture4).toHaveLength(3);
    expect(results.fixture5).toHaveLength(3);
    expect(results.fixture6).toHaveLength(4);
  }, budgetMs);

  it("rejects a local declaration shadowing an approved reporting helper", async () => {
    const results = await lint({
      fixture1: `
      function observeSafely(x: unknown): void {}
      try { run(); } catch (error) { observeSafely(error); }
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(1);
  }, budgetMs);

  it("rejects an alias of a non-approved reporting export", async () => {
    const results = await lint({
      fixture1: `
      import { buildClientErrorReport as reportClientError } from "@/client/observability/client-reporter";
      try { run(); } catch (error) { reportClientError(error); }
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(1);
  }, budgetMs);

  it("rejects a parameter shadowing a throwing same-file helper", async () => {
    const results = await lint({
      fixture1: `
      function observeSafely(x: unknown): never { throw x; }
      function handle(observeSafely: (x: unknown) => void): void {
        try { run(); } catch (error) { observeSafely(error); }
      }
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(1);
  }, budgetMs);

  it("accepts a throwing same-file helper shadowing a same-name no-op helper", async () => {
    const results = await lint({
      fixture1: `
      function reportFailure(): void {}
      function handle(): void {
        function reportFailure(): never { throw new Error("failed"); }
        try { run(); } catch { reportFailure(); }
      }
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);

  it("accepts approved aliases wrapping an injected telemetry sink", async () => {
    const results = await lint({
      fixture1: `
      import { observeSafely as reportTelemetry } from "@/server/observability/log";
      function reportSafely(log: (error: unknown) => void, error: unknown): void { reportTelemetry(() => log(error)); }
      function handle() { try { run(); } catch (error) { reportSafely(log, error); } }
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);

  it("rejects an object method named like an approved reporting helper", async () => {
    const results = await lint({
      fixture1: `
      try { run(); } catch (error) { sink.observeSafely(error); }
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(1);
  }, budgetMs);

  it("rejects a reporting helper imported from an unapproved module", async () => {
    const results = await lint({
      fixture1: `
      import { observeSafely } from "./local-sink";
      try { run(); } catch (error) { observeSafely(error); }
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(1);
  }, budgetMs);

  it("accepts a directly imported wrapper around a real noncritical telemetry sink", async () => {
    const results = await lint({
      fixture1: `
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
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);

  it("accepts returned conditional, sequence and helper telemetry writes", async () => {
    const results = await lint({
      fixture1: `
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
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);

  it("rejects telemetry sinks whose injected parameter is reassigned", async () => {
    const diagnostics = (await lint({ fixture1: `
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
    ` }, { rule: "no-silent-catch", options })).fixture1;
    expect(diagnostics).toHaveLength(3);
    for (const diagnostic of diagnostics) expect(diagnostic.message).toBe(messages.silent);
  }, budgetMs);

  it("accepts a finalizer that always reports and rejects non-disposing finalizers", async () => {
    const results = await lint({
      fixture1: `
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
    `,
      fixture2: `
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
    `,
    }, { rule: "no-silent-catch", options });
    expect(results.fixture1).toHaveLength(0);
    const diagnostics = results.fixture2;
    expect(diagnostics).toHaveLength(3);
    for (const diagnostic of diagnostics) expect(diagnostic.message).toBe(messages.silent);
  }, budgetMs);

  it("rejects generator rejection callbacks and yielding arms", async () => {
    const results = await lint({
      fixture1: `
      import { reportClientError } from "@/client/observability/client-reporter";
      function* handle() {
        try { run(); } catch (error) { try { yield 1; } finally { reportClientError(error); } }
      }
      run().catch(function* (error) { try { risky(); } finally { reportClientError(error); } });
      run().then(ok, function* (error) { try { risky(); } finally { reportClientError(error); } });
    `,
      fixture2: `
      import { reportClientError } from "@/client/observability/client-reporter";
      function handle() { try { run(); } catch (error) { try { risky(); } finally { reportClientError(error); } } }
      run().catch((error) => { try { risky(); } finally { reportClientError(error); } });
    `,
    }, { rule: "no-silent-catch", options });
    const diagnostics = results.fixture1;
    expect(diagnostics).toHaveLength(3);
    for (const diagnostic of diagnostics) expect(diagnostic.message).toBe(messages.silent);
    expect(results.fixture2).toHaveLength(0);
  }, budgetMs);

  it("rejects a finalizer that declares a resource before reporting", async () => {
    const results = await lint({
      fixture1: `
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
    `,
      fixture2: `
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
    `,
    }, { rule: "no-silent-catch", options });
    const diagnostics = results.fixture1;
    expect(diagnostics).toHaveLength(2);
    for (const diagnostic of diagnostics) expect(diagnostic.message).toBe(messages.silent);
    expect(results.fixture2).toHaveLength(0);
  }, budgetMs);

  it("rejects generator dispositions that never report", async () => {
    const results = await lint({
      fixture1: `
      import { observeSafely } from "@/server/observability/log";
      import { reportClientError } from "@/client/observability/client-reporter";
      function* reporting() { reportClientError("failed"); }
      function plainReporting() { reportClientError("failed"); }
      function handle() {
        try { run(); } catch (error) { try { risky(); } finally { reporting(); } }
        try { run(); } catch (error) { try { risky(); } finally { observeSafely(function* () { return reportClientError(error); }); } }
        try { run(); } catch (error) { try { risky(); } finally { observeSafely(async function* () { return reportClientError(error); }); } }
      }
    `,
      fixture2: `
      import { reportClientError } from "@/client/observability/client-reporter";
      function* reporting() { reportClientError("failed"); }
      function plainReporting() { reportClientError("failed"); }
      function handle() { try { run(); } catch (error) { try { risky(); } finally { plainReporting(); } } }
    `,
    }, { rule: "no-silent-catch", options });
    const diagnostics = results.fixture1;
    expect(diagnostics).toHaveLength(3);
    for (const diagnostic of diagnostics) expect(diagnostic.message).toBe(messages.silent);
    expect(results.fixture2).toHaveLength(0);
  }, budgetMs);

  it("applies the abrupt-completion guard to concise bodies", async () => {
    const results = await lint({
      fixture1: `
      import { observeSafely } from "@/server/observability/log";
      import { reportClientError } from "@/client/observability/client-reporter";
      const conciseHelper = (error: unknown) => reportClientError(class { static { throw error; } });
      function handle() {
        try { run(); } catch (error) { try { risky(); } finally { observeSafely(() => reportClientError(class { static { throw error; } })); } }
        try { run(); } catch (error) { try { risky(); } finally { conciseHelper(error); } }
      }
    `,
      fixture2: `
      import { observeSafely } from "@/server/observability/log";
      import { reportClientError } from "@/client/observability/client-reporter";
      const conciseHelper = (error: unknown) => reportClientError(error);
      function handle() {
        try { run(); } catch (error) { try { risky(); } finally { observeSafely(() => reportClientError(error)); } }
        try { run(); } catch (error) { try { risky(); } finally { conciseHelper(error); } }
      }
    `,
    }, { rule: "no-silent-catch", options });
    const diagnostics = results.fixture1;
    expect(diagnostics).toHaveLength(2);
    for (const diagnostic of diagnostics) expect(diagnostic.message).toBe(messages.silent);
    expect(results.fixture2).toHaveLength(0);
  }, budgetMs);

  it("rejects a finalizer whose report a conditional jump can skip", async () => {
    const diagnostics = (await lint({ fixture1: `
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
    ` }, { rule: "no-silent-catch", options })).fixture1;
    expect(diagnostics).toHaveLength(3);
    for (const diagnostic of diagnostics) expect(diagnostic.message).toBe(messages.silent);
  }, budgetMs);

  it("rejects a finalizer whose report an unsupported exit can skip", async () => {
    const diagnostics = (await lint({ fixture1: `
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
    ` }, { rule: "no-silent-catch", options })).fixture1;
    expect(diagnostics).toHaveLength(4);
    for (const diagnostic of diagnostics) expect(diagnostic.message).toBe(messages.silent);
  }, budgetMs);

  it("rejects a finalizer whose report a yield can skip", async () => {
    const results = await lint({
      fixture1: `
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
    `,
      fixture2: `
      import { reportClientError } from "@/client/observability/client-reporter";
      function* third() { try { run(); } catch (error) { try { risky(); } finally { reportClientError(error); } } }
    `,
    }, { rule: "no-silent-catch", options });
    const diagnostics = results.fixture1;
    expect(diagnostics).toHaveLength(2);
    for (const diagnostic of diagnostics) expect(diagnostic.message).toBe(messages.silent);
    expect(results.fixture2).toHaveLength(0);
  }, budgetMs);

  it("rejects a finalizer whose report an executed class body can skip", async () => {
    const results = await lint({
      fixture1: `
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
    `,
      fixture2: `
      import { reportClientError } from "@/client/observability/client-reporter";
      function handle() {
        try { run(); } catch (error) {
          try { risky(); } finally { const line = build(); reportClientError(line); }
        }
        try { run(); } catch (error) {
          try { risky(); } finally { const f = () => class { static { throw error; } }; reportClientError(error); }
        }
      }
    `,
    }, { rule: "no-silent-catch", options });
    const diagnostics = results.fixture1;
    expect(diagnostics).toHaveLength(3);
    for (const diagnostic of diagnostics) expect(diagnostic.message).toBe(messages.silent);
    expect(results.fixture2).toHaveLength(0);
  }, budgetMs);

  it("documents the loop-local jump bound", async () => {
    const diagnostics = (await lint({ fixture1: `
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
    ` }, { rule: "no-silent-catch", options })).fixture1;
    expect(diagnostics).toHaveLength(1);
    for (const diagnostic of diagnostics) expect(diagnostic.message).toBe(messages.silent);
  }, budgetMs);

  it("rejects unreachable reports after divergent loops and accepts first-iteration reports", async () => {
    const results = await lint({
      fixture1: `
      import { reportClientError } from "@/client/observability/client-reporter";
      function handle() {
        try { run(); } catch (error) { while (true) {} reportClientError(error); }
        try { run(); } catch (error) { for (;;) {} reportClientError(error); }
        try { run(); } catch (error) { for (; true; ) {} reportClientError(error); }
      }
    `,
      fixture2: `
      import { reportClientError } from "@/client/observability/client-reporter";
      function handle() {
        try { run(); } catch (error) { do { reportClientError(error); } while (true); }
        try { run(); } catch (error) { while (true) { reportClientError(error); } }
      }
    `,
    }, { rule: "no-silent-catch", options });
    expect(results.fixture1).toHaveLength(3);
    for (const diagnostic of results.fixture1) expect(diagnostic.message).toBe(messages.silent);
    expect(results.fixture2).toHaveLength(0);
  }, budgetMs);

  it("rejects divergent finalizers and arms that cannot reach reporting finalizers", async () => {
    const results = await lint({
      fixture1: `
      import { reportClientError } from "@/client/observability/client-reporter";
      function handle() {
        try { run(); } catch (error) {
          try { risky(); } finally { do {} while (true); reportClientError(error); }
        }
        try { run(); } catch (error) {
          try { while (true) {} } finally { reportClientError(error); }
        }
        try { run(); } catch (error) {
          try { risky(); } catch { for (;;) {} } finally { reportClientError(error); }
        }
      }
    `,
      fixture2: `
      import { reportClientError } from "@/client/observability/client-reporter";
      function handle() {
        try { run(); } catch (error) {
          try { risky(); } finally { do { reportClientError(error); } while (true); }
        }
      }
    `,
    }, { rule: "no-silent-catch", options });
    expect(results.fixture1).toHaveLength(4);
    for (const diagnostic of results.fixture1) expect(diagnostic.message).toBe(messages.silent);
    expect(results.fixture2).toHaveLength(0);
  }, budgetMs);

  it("rejects divergent observeSafely finalizers before telemetry", async () => {
    const results = await lint({
      fixture1: `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      function handle() {
        try { run(); } catch (error) {
          observeSafely(async () => { try { risky(); } finally { do {} while (true); await emitServerEvent("x", {}); } });
        }
      }
    `,
      fixture2: `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      function handle() {
        try { run(); } catch (error) {
          observeSafely(async () => { try { risky(); } finally { do { await emitServerEvent("x", {}); } while (true); } });
        }
      }
    `,
    }, { rule: "no-silent-catch", options });
    expect(results.fixture1).toHaveLength(1);
    for (const diagnostic of results.fixture1) expect(diagnostic.message).toBe(messages.silent);
    expect(results.fixture2).toHaveLength(0);
  }, budgetMs);

  it("accepts a returned telemetry write inside its own divergent loop", async () => {
    const results = await lint({
      fixture1: `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      function handle() {
        try { run(); } catch (error) {
          observeSafely(async () => { try { risky(); } finally { do { return emitServerEvent("x", {}); } while (true); } });
        }
        try { run(); } catch (error) {
          observeSafely(async () => { try { risky(); } finally { for (;;) { return emitServerEvent("x", {}); } } });
        }
      }
    `,
      fixture2: `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      function handle() {
        try { run(); } catch (error) {
          observeSafely(async () => { try { risky(); } finally { do {} while (true); return emitServerEvent("x", {}); } });
        }
      }
    `,
    }, { rule: "no-silent-catch", options });
    expect(results.fixture1).toHaveLength(0);
    expect(results.fixture2).toHaveLength(1);
    for (const diagnostic of results.fixture2) expect(diagnostic.message).toBe(messages.silent);
  }, budgetMs);

  it("rejects retained fallbacks behind divergent catches but preserves finite-loop fallbacks", async () => {
    const results = await lint({
      fixture1: `
      import { reportClientError } from "@/client/observability/client-reporter";
      async function read() {
        let status = "ready";
        try { status = await load(); } catch (error) { while (true) {} reportClientError(error); }
        consume(status);
      }
    `,
      fixture2: `
      import { reportClientError } from "@/client/observability/client-reporter";
      async function read() {
        let status = "ready";
        await load().then((value) => { status = value; }).catch((error) => { while (true) {} reportClientError(error); });
        consume(status);
      }
    `,
      fixture3: `
      async function read() {
        let status = "ready";
        try { status = await load(); } catch { while (condition) {} }
        consume(status);
        await load().then((value) => { status = value; }).catch(() => { while (condition) {} });
        consume(status);
      }
    `,
    }, { rule: "no-silent-catch", options });
    expect(results.fixture1).toHaveLength(1);
    expect(results.fixture1[0].message).toBe(messages.silent);
    expect(results.fixture2).toHaveLength(1);
    expect(results.fixture2[0].message).toBe(messages.silent);
    expect(results.fixture3).toHaveLength(0);
  }, budgetMs);

  it("rejects divergent arms before direct and nested throwing finalizers", async () => {
    const results = await lint({
      fixture1: `
      function handle() {
        try { run(); } catch (error) {
          try { while (true) {} } finally { throw error; }
        }
        try { run(); } catch (error) {
          try { risky(); } finally {
            try { while (true) {} } finally { throw error; }
          }
        }
      }
    `,
      fixture2: `
      function handle() {
        try { run(); } catch (error) {
          try { risky(); } finally { throw error; }
        }
      }
    `,
    }, { rule: "no-silent-catch", options });
    expect(results.fixture1).toHaveLength(2);
    for (const diagnostic of results.fixture1) expect(diagnostic.message).toBe(messages.silent);
    expect(results.fixture2).toHaveLength(0);
  }, budgetMs);

  it("rejects divergent finalizers even after every arm has already reported", async () => {
    const diagnostics = (await lint({ fixture1: `
      import { reportClientError } from "@/client/observability/client-reporter";
      function handle() {
        try { run(); } catch (error) {
          try { reportClientError(error); } catch { reportClientError(error); } finally { while (true) {} }
        }
      }
    ` }, { rule: "no-silent-catch", options })).fixture1;
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toBe(messages.silent);
  }, budgetMs);

  it("rejects returns, throws, and retained fallbacks blocked by divergent finalizers", async () => {
    const results = await lint({
      fixture1: `
      import { reportClientError } from "@/client/observability/client-reporter";
      function handle() {
        try { run(); } catch (error) {
          try { return null; } catch { return null; } finally { do {} while (true); reportClientError(error); }
        }
      }
    `,
      fixture2: `
      async function read() {
        let status = "ready";
        try { status = await load(); } catch (error) {
          try { throw error; } finally { while (true) {} }
        }
        consume(status);
      }
    `,
      fixture3: `
      function handle() {
        try { run(); } catch (error) {
          try { risky(); } finally {
            try { throw error; } catch { throw error; } finally { while (true) {} }
          }
        }
      }
    `,
    }, { rule: "no-silent-catch", options });
    for (const diagnostics of Object.values(results)) {
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).toBe(messages.silent);
    }
  }, budgetMs);

  it("rejects 18 nested divergent finalizers within the lint budget", async () => {
    let nested = "while (true) {}";
    for (let depth = 0; depth < 18; depth += 1) {
      nested = `try { risky(); } finally { ${nested} }`;
    }
    const diagnostics = (await lint({ fixture1: `
      function handle() {
        try { run(); } catch (error) {
          try { ${nested} } finally { throw error; }
        }
      }
    ` }, { rule: "no-silent-catch", options })).fixture1;
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toBe(messages.silent);
  }, budgetMs);

  it("rejects a same-file helper with 24 nested divergent finalizers within the lint budget", async () => {
    let nested = "while (true) {}";
    for (let depth = 0; depth < 24; depth += 1) {
      nested = `try { risky(); } finally { ${nested} }`;
    }
    const started = performance.now();
    const diagnostics = (await lint({ fixture1: `
      function finishFailure() {
        try { ${nested} } finally { throw new Error("cleanup failed"); }
      }
      try { run(); } catch (error) { finishFailure(); }
    ` }, { rule: "no-silent-catch", options })).fixture1;
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toBe(messages.silent);
    expect(performance.now() - started).toBeLessThan(budgetMs);
  }, budgetMs);

  it("rejects a 30-helper branching DAG across 24 catches within the lint budget", async () => {
    const helpers = Array.from({ length: 30 }, (_, index) =>
      `function h${index}() { ${index < 28 ? `h${index + 1}(); h${index + 2}();` : ""} }`).join("\n");
    const catches = Array.from({ length: 24 }, () =>
      "try { run(); } catch (error) { h0(); }").join("\n");
    const started = performance.now();
    const diagnostics = (await lint({ fixture1: `${helpers}\n${catches}` },
      { rule: "no-silent-catch", options })).fixture1;
    expect(diagnostics).toHaveLength(24);
    for (const diagnostic of diagnostics) expect(diagnostic.message).toBe(messages.silent);
    expect(performance.now() - started).toBeLessThan(budgetMs);
  }, budgetMs);

  it("accepts throwing finalizers over a cyclic 38-helper graph across 24 catches within the lint budget", async () => {
    const helpers = Array.from({ length: 38 }, (_, index) =>
      `function h${index}() { ${index < 36 ? `h${index + 1}(); h${index + 2}();` : "h0();"} }`).join("\n");
    const catches = Array.from({ length: 24 }, () =>
      "try { run(); } catch (error) { try { h0(); } finally { throw error; } }").join("\n");
    const started = performance.now();
    const diagnostics = (await lint({ fixture1: `${helpers}\n${catches}` },
      { rule: "no-silent-catch", options })).fixture1;
    expect(diagnostics).toHaveLength(0);
    expect(performance.now() - started).toBeLessThan(budgetMs);
  }, budgetMs);

  it("rejects divergent arms over a cyclic 38-helper graph across 24 catches within the lint budget", async () => {
    const helpers = Array.from({ length: 38 }, (_, index) =>
      `function h${index}() { ${index < 36 ? `h${index + 1}(); h${index + 2}();` : "h0();"} }`).join("\n");
    const catches = Array.from({ length: 24 }, () =>
      "try { run(); } catch (error) { try { h0(); while (true) {} } finally { throw error; } }").join("\n");
    const started = performance.now();
    const diagnostics = (await lint({ fixture1: `${helpers}\n${catches}` },
      { rule: "no-silent-catch", options })).fixture1;
    expect(diagnostics).toHaveLength(24);
    for (const diagnostic of diagnostics) expect(diagnostic.message).toBe(messages.silent);
    expect(performance.now() - started).toBeLessThan(budgetMs);
  }, budgetMs);

  it("accepts 1,200 nested throwing finalizers within the lint budget", async () => {
    let nested = "risky();";
    for (let depth = 0; depth < 1_200; depth += 1) {
      nested = `try { ${nested} } finally { throw error; }`;
    }
    const started = performance.now();
    const diagnostics = (await lint({ fixture1:
      `try { run(); } catch (error) { ${nested} }` },
      { rule: "no-silent-catch", options })).fixture1;
    expect(diagnostics).toHaveLength(0);
    expect(performance.now() - started).toBeLessThan(budgetMs);
  }, budgetMs);

  it("rejects mutually recursive helpers with a throwing alternative at either entry point", async () => {
    const diagnostics = (await lint({ fixture1: `
      function a() { if (flag) b(); else throw error; }
      function b() { a(); }
      try { run(); } catch (error) { a(); }
      try { run(); } catch (error) { b(); }
      try { run(); } catch (error) { a(); b(); }
    ` }, { rule: "no-silent-catch", options })).fixture1;
    expect(diagnostics).toHaveLength(3);
    for (const diagnostic of diagnostics) expect(diagnostic.message).toBe(messages.silent);
  }, budgetMs);

  it("rejects returned telemetry blocked by a divergent finalizer", async () => {
    const diagnostics = (await lint({ fixture1: `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      function handle() {
        try { run(); } catch (error) {
          observeSafely(() => { try { return emitServerEvent("x", {}); } finally { while (true) {} } });
        }
      }
    ` }, { rule: "no-silent-catch", options })).fixture1;
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toBe(messages.silent);
  }, budgetMs);

  it("preserves finite and jump-bearing loop dispositions", async () => {
    const diagnostics = (await lint({ fixture1: `
      import { reportClientError } from "@/client/observability/client-reporter";
      function handle() {
        try { run(); } catch (error) { do { if (flag) break; } while (true); reportClientError(error); }
        try { run(); } catch (error) { while (condition) {} reportClientError(error); }
        try { run(); } catch (error) {
          try { risky(); } finally { do { reportClientError(error); } while (false); }
        }
      }
    ` }, { rule: "no-silent-catch", options })).fixture1;
    expect(diagnostics).toHaveLength(0);
  }, budgetMs);

  it("accepts a nested finalizer that reports on every path", async () => {
    expect((await lint({ fixture1: `
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
    ` }, { rule: "no-silent-catch", options })).fixture1).toHaveLength(0);
  }, budgetMs);

  it("accepts sibling returned telemetry writes in an own finalizer but keeps conditional throws interrupting", async () => {
    const results = await lint({
      fixture1: `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      try { run(); } catch (error) {
        observeSafely(() => { try { risky(); } finally { if (flag) return emitServerEvent("x", {}); return emitServerEvent("y", {}); } });
      }
    `,
      fixture2: `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      try { run(); } catch (error) {
        observeSafely(() => { try { risky(); } finally { if (flag) { (() => { throw error; })(); } return emitServerEvent("x", {}); } });
      }
    `,
      fixture3: `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      try { run(); } catch (error) {
        observeSafely(async () => { try { risky(); } finally { if (flag) return await emitServerEvent("x", {}); return emitServerEvent("y", {}); } });
      }
    `,
      fixture4: `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      try { run(); } catch (error) {
        observeSafely(async () => { try { risky(); } finally { if (flag) { return await emitServerEvent("x", {}); } else { return emitServerEvent("y", {}); } } });
      }
    `,
    }, { rule: "no-silent-catch", options });
    expect(results.fixture1).toHaveLength(0);
    expect(results.fixture2).toHaveLength(1);
    expect(results.fixture3).toHaveLength(0);
    expect(results.fixture4).toHaveLength(0);
  }, budgetMs);

  for (const { name, body, expected } of [
    {
      name: "rejects a bare returned telemetry write after a throwing finalizer IIFE",
      body: `try { risky(); } finally { (() => { throw error; })(); return emitServerEvent("x", {}); }`,
      expected: 1,
    },
    {
      name: "accepts awaited telemetry after a throwing finalizer IIFE",
      body: `try { risky(); } finally { (() => { throw error; })(); return await emitServerEvent("x", {}); }`,
      expected: 0,
    },
    {
      name: "accepts a returned telemetry write after a non-throwing finalizer IIFE",
      body: `try { risky(); } finally { (() => { pending.delete(key); })(); return emitServerEvent("x", {}); }`,
      expected: 0,
    },
    {
      name: "rejects a bare returned telemetry write after a throwing static field initializer",
      body: `try { risky(); } finally { class Nested { static field = (() => { throw error; })(); } return emitServerEvent("x", {}); }`,
      expected: 1,
    },
    {
      name: "rejects a bare returned telemetry write inside a for-of body with a later disposition",
      body: `for (const item of items) { return emitServerEvent("x", {}); } return emitServerEvent("y", {});`,
      expected: 1,
    },
    {
      name: "accepts awaited telemetry inside a for-of body with a later disposition",
      body: `for (const item of items) { return await emitServerEvent("x", {}); } return emitServerEvent("y", {});`,
      expected: 0,
    },
    {
      name: "accepts a for-of body without a return before a returned telemetry write",
      body: `for (const item of items) { pending.delete(item); } return emitServerEvent("y", {});`,
      expected: 0,
    },
    {
      name: "rejects returned telemetry discarded by a throwing finalizer IIFE parameter default",
      body: `try { return emitServerEvent("x", {}); } catch { return emitServerEvent("x", {}); } finally { ((x = (() => { throw error; })()) => {})(); }`,
      expected: 1,
    },
    {
      name: "rejects returned telemetry discarded by a disposing finalizer IIFE parameter default",
      body: `try { return emitServerEvent("x", {}); } catch { return emitServerEvent("x", {}); } finally { ((x = (() => { using resource = disposable; })()) => {})(); }`,
      expected: 1,
    },
    {
      name: "rejects returned telemetry discarded by a nested finalizer IIFE parameter default",
      body: `try { return emitServerEvent("x", {}); } catch { return emitServerEvent("x", {}); } finally { (() => { ((x = (() => { throw error; })()) => {})(); })(); }`,
      expected: 1,
    },
    {
      name: "rejects returned telemetry discarded by a throwing finalizer generator parameter default",
      body: `try { return emitServerEvent("x", {}); } catch { return emitServerEvent("x", {}); } finally { (function*(x = (() => { throw error; })()) {})(); }`,
      expected: 1,
    },
    {
      name: "rejects returned telemetry discarded by a throwing finalizer async generator parameter default",
      body: `try { return emitServerEvent("x", {}); } catch { return emitServerEvent("x", {}); } finally { (async function*(x = (() => { throw error; })()) {})(); }`,
      expected: 1,
    },
    {
      name: "rejects returned telemetry discarded by a disposing finalizer generator parameter default",
      body: `try { return emitServerEvent("x", {}); } catch { return emitServerEvent("x", {}); } finally { (function*(x = (() => { using resource = disposable; })()) {})(); }`,
      expected: 1,
    },
    {
      name: "accepts returned telemetry before a non-throwing finalizer generator parameter default",
      body: `try { return emitServerEvent("x", {}); } catch { return emitServerEvent("x", {}); } finally { (function*(x = 1) {})(); }`,
      expected: 0,
    },
    {
      name: "accepts returned telemetry before a throwing finalizer async parameter default",
      body: `try { return emitServerEvent("x", {}); } catch { return emitServerEvent("x", {}); } finally { (async (x = (() => { throw error; })()) => {})(); }`,
      expected: 0,
    },
    {
      name: "accepts returned telemetry before a non-throwing finalizer IIFE parameter default",
      body: `try { return emitServerEvent("x", {}); } catch { return emitServerEvent("x", {}); } finally { ((x = 1) => {})(); }`,
      expected: 0,
    },
    {
      name: "accepts returned telemetry before a supplied-argument finalizer IIFE without a default",
      body: `try { return emitServerEvent("x", {}); } catch { return emitServerEvent("x", {}); } finally { ((x) => {})(1); }`,
      expected: 0,
    },
    {
      name: "accepts awaited telemetry before a throwing finalizer IIFE parameter default",
      body: `try { return await emitServerEvent("x", {}); } catch { return await emitServerEvent("x", {}); } finally { ((x = (() => { throw error; })()) => {})(); }`,
      expected: 0,
    },
    {
      name: "rejects a bare returned telemetry write discarded by an enclosing finalizer IIFE",
      body: `try { return emitServerEvent("x", {}); } catch { return emitServerEvent("x", {}); } finally { (() => { throw error; })(); }`,
      expected: 1,
    },
    {
      name: "accepts awaited telemetry before a throwing enclosing finalizer IIFE",
      body: `try { return await emitServerEvent("x", {}); } catch { return await emitServerEvent("x", {}); } finally { (() => { throw error; })(); }`,
      expected: 0,
    },
    {
      name: "accepts returned telemetry before a generator finalizer IIFE",
      body: `try { return emitServerEvent("x", {}); } catch { return emitServerEvent("x", {}); } finally { (function* () { throw error; })(); }`,
      expected: 0,
    },
    {
      name: "accepts returned telemetry before an async finalizer IIFE",
      body: `try { return emitServerEvent("x", {}); } catch { return emitServerEvent("x", {}); } finally { (async () => { throw error; })(); }`,
      expected: 0,
    },
    {
      name: "rejects returned telemetry discarded by an as-wrapped finalizer IIFE",
      body: `try { return emitServerEvent("x", {}); } catch { return emitServerEvent("x", {}); } finally { ((() => { throw error; }) as () => void)(); }`,
      expected: 1,
    },
    {
      name: "rejects returned telemetry discarded by a satisfies-wrapped finalizer IIFE",
      body: `try { return emitServerEvent("x", {}); } catch { return emitServerEvent("x", {}); } finally { ((() => { throw error; }) satisfies () => void)(); }`,
      expected: 1,
    },
    {
      name: "accepts returned telemetry before a generator finalizer IIFE with a resource",
      body: `try { return emitServerEvent("x", {}); } catch { return emitServerEvent("x", {}); } finally { (function* () { using resource = disposable; })(); }`,
      expected: 0,
    },
    {
      name: "accepts returned telemetry before a nested generator finalizer IIFE",
      body: `try { return emitServerEvent("x", {}); } catch { return emitServerEvent("x", {}); } finally { (() => { (function* () { throw error; })(); })(); }`,
      expected: 0,
    },
    {
      name: "accepts returned telemetry before a nested async finalizer IIFE",
      body: `try { return emitServerEvent("x", {}); } catch { return emitServerEvent("x", {}); } finally { (() => { (async () => { throw error; })(); })(); }`,
      expected: 0,
    },
    {
      name: "rejects returned telemetry discarded by a nested as-wrapped finalizer IIFE",
      body: `try { return emitServerEvent("x", {}); } catch { return emitServerEvent("x", {}); } finally { (() => { ((() => { throw error; }) as () => void)(); })(); }`,
      expected: 1,
    },
    {
      name: "accepts returned telemetry before a locally returning enclosing finalizer IIFE",
      body: `try { return emitServerEvent("x", {}); } catch { return emitServerEvent("x", {}); } finally { (() => { return 1; })(); }`,
      expected: 0,
    },
    {
      name: "rejects returned telemetry discarded by an enclosing finalizer static field initializer",
      body: `try { return emitServerEvent("x", {}); } catch { return emitServerEvent("x", {}); } finally { class Nested { static field = (() => { throw error; })(); } }`,
      expected: 1,
    },
    {
      name: "accepts returned telemetry before an unexecuted finalizer instance field initializer",
      body: `try { return emitServerEvent("x", {}); } catch { return emitServerEvent("x", {}); } finally { class Nested { field = (() => { throw error; })(); } }`,
      expected: 0,
    },
  ]) {
    it(name, async () => {
      const diagnostics = (await lint({ fixture1: `
        import { observeSafely, emitServerEvent } from "@/server/observability/log";
        try { run(); } catch (error) { observeSafely(async () => { ${body} }); }
      ` }, { rule: "no-silent-catch", options })).fixture1;
      expect(diagnostics).toHaveLength(expected);
      for (const diagnostic of diagnostics) expect(diagnostic.message).toBe(messages.silent);
    }, budgetMs);
  }

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
      const results = await lint({
        fixture1: `
        import { observeSafely, emitServerEvent } from "@/server/observability/log";
        async function report(cleanup: Promise<void>) {
          try { run(); } catch (error) { observeSafely(async () => { ${body} }); } finally { await cleanup; }
        }
      `,
      }, { rule: "no-silent-catch", options: options });
      expect(results.fixture1).toHaveLength(expected);
    }, budgetMs);
  }

  it("rejects a returned telemetry write discarded by a same-scope using declaration", async () => {
    const results = await lint({
      fixture1: `
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
    `,
      fixture2: `
      import { observeSafely } from "@/server/observability/log";
      function report(log: (error: unknown) => Promise<unknown>) {
        observeSafely(async () => { try { risky(); } finally { using r = resource; return await log(error); } });
      }
      function handle() { try { run(); } catch (error) { report(log); } }
    `,
    }, { rule: "no-silent-catch", options });
    const diagnostics = results.fixture1;
    expect(diagnostics).toHaveLength(2);
    for (const diagnostic of diagnostics) expect(diagnostic.message).toBe(messages.silent);
    expect(results.fixture2).toHaveLength(0);
  }, budgetMs);
  for (const [name, loop] of [
    ["for-of", "for (using resource of resources)"],
    ["for-await-of", "for await (using resource of resources)"],
    ["for", "for (using resource = acquire();;)"],
  ]) {
    it(`rejects returned telemetry exiting a ${name} resource scope`, async () => {
      const results = await lint({
        fixture1: `
        import { observeSafely } from "@/server/observability/log";
        function report(sink: (error: unknown) => Promise<unknown>) {
          observeSafely(async () => { ${loop} { return sink(error); } });
        }
        try { run(); } catch (error) { report(sink); }
      `,
      }, { rule: "no-silent-catch", options: options });
      expect(results.fixture1).toHaveLength(1);
    }, budgetMs);
  }

  it("rejects discarded telemetry sink calls inside observeSafely callbacks", async () => {
    const results = await lint({
      fixture1: `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      try { run(); } catch (error) { observeSafely(() => { emitServerEvent("x", { code: String(error) }); }); }
    `,
      fixture2: `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      try { run(); } catch (error) { observeSafely(() => { void emitServerEvent("x", { code: String(error) }); }); }
    `,
      fixture3: `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      try { run(); } catch (error) { observeSafely(() => { if (condition) emitServerEvent("x", { code: String(error) }); else return emitServerEvent("x", { code: String(error) }); }); }
    `,
      fixture4: `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      try { run(); } catch (error) { observeSafely(() => { emitServerEvent("x", {}); }); }
    `,
      fixture5: `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      try { run(); } catch (error) { observeSafely(() => { const pending = emitServerEvent("x", { code: String(error) }); }); }
    `,
      fixture6: `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      try { run(); } catch (error) { observeSafely(() => { condition ? emitServerEvent("x", { code: String(error) }) : emitServerEvent("x", { code: String(error) }); }); }
    `,
      fixture7: `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      try { run(); } catch (error) { observeSafely(() => { queue.push(emitServerEvent("x", { code: String(error) })); }); }
    `,
      fixture8: `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      try { run(); } catch (error) { observeSafely(() => { return [emitServerEvent("x", { code: String(error) })]; }); }
    `,
      fixture9: `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      try { run(); } catch (error) { observeSafely(async () => { await [emitServerEvent("x", { code: String(error) })]; }); }
    `,
      fixture10: `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      try { run(); } catch (error) { observeSafely(() => { if (emitServerEvent("x", { code: String(error) })) { work(); } }); }
    `,
      fixture11: `
      import { observeSafely, emitServerEvent } from "@/server/observability/log";
      try { run(); } catch (error) { observeSafely(() => { function helper() { return emitServerEvent("x", { code: String(error) }); } helper(); }); }
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(1);
    expect(results.fixture2).toHaveLength(1);
    expect(results.fixture3).toHaveLength(1);
    expect(results.fixture4).toHaveLength(1);
    expect(results.fixture5).toHaveLength(1);
    expect(results.fixture6).toHaveLength(1);
    expect(results.fixture7).toHaveLength(1);
    expect(results.fixture8).toHaveLength(1);
    expect(results.fixture9).toHaveLength(1);
    expect(results.fixture10).toHaveLength(1);
    expect(results.fixture11).toHaveLength(1);
  }, budgetMs);

  it("accepts approved reporting imports and a directly injected sink in telemetry callbacks", async () => {
    const results = await lint({
      fixture1: `
      import { observeSafely, emitServerEvent as emit, writeObservabilityEvent } from "@/server/observability/log";
      import { reportClientError as send } from "@/client/observability/client-reporter";
      function reportSafely(sink: (failure: unknown) => void, error: unknown): void { observeSafely(() => sink(error)); }
      function report() {
        try { run(); } catch (error) { reportSafely(sink, error); }
        try { run(); } catch (error) { observeSafely(() => emit("failure", { code: String(error) })); }
        try { run(); } catch (error) { observeSafely(() => writeObservabilityEvent({ code: String(error) })); }
        try { run(); } catch (error) { observeSafely(() => send({ name: "Failure", message: String(error), route: "/" })); }
      }
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);

  it("rejects wrappers whose callbacks return or discard a failure without reporting it", async () => {
    const results = await lint({
      fixture1: `
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
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(8);
  }, budgetMs);

  it("accepts an injected sink declared by a delegation wrapper reached from a catch", async () => {
    const results = await lint({
      fixture1: `
      import { observeSafely } from "@/server/observability/log";
      function reportSubscriptionFailureSafely(log: (reason: string) => void, reason: string): void { observeSafely(() => log(reason)); }
      async function ensureAddressSubscribed(address: string) {
        try { await ensure(address); } catch (error) { reportSubscriptionFailureSafely(logFailure, error instanceof Error ? error.message : "subscription-failed"); }
      }
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);

  it("rejects an injected callback used as a sink outside a delegation wrapper", async () => {
    const results = await lint({
      fixture1: `
      import { observeSafely } from "@/server/observability/log";
      async function handle(load: () => Promise<void>, persistFailure: (error: unknown) => Promise<void>) {
        try { await load(); } catch (error) { observeSafely(() => persistFailure(error)); }
      }
      function handleOther(log: (event: object) => unknown) {
        try { run(); } catch { observeSafely(() => log({ outcome: "unavailable" })); }
      }
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(2);
  }, budgetMs);

  it("rejects a delegation wrapper whose body does other work", async () => {
    const results = await lint({
      fixture1: `
      import { observeSafely } from "@/server/observability/log";
      function reportSafely(log: (reason: string) => void, reason: string): void { setup(); observeSafely(() => log(reason)); }
      function handle() { try { run(); } catch (error) { reportSafely(log, String(error)); } }
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(1);
  }, budgetMs);

  it("rejects a delegation wrapper that hides the telemetry call behind other work", async () => {
    const results = await lint({
      fixture1: `
      import { observeSafely } from "@/server/observability/log";
      function reportSequence(log: (error: unknown) => void, error: unknown): void { (setup(), observeSafely(() => log(error))); }
      const makeHandler = (persistence: (error: unknown) => void) => () => {
        try { run(); } catch (error) { observeSafely(() => persistence(error)); }
      };
      function handle() {
        try { run(); } catch (error) { reportSequence(log, error); }
      }
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(2);
  }, budgetMs);

  it("rejects an injected sink behind an inline rejection handler", async () => {
    const results = await lint({
      fixture1: `
      import { observeSafely } from "@/server/observability/log";
      function handle(load: () => Promise<void>, persistFailure: (error: unknown) => Promise<void>) {
        return load().catch((error) => { observeSafely(() => persistFailure(error)); });
      }
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(1);
  }, budgetMs);

  it("accepts a concise arrow delegation wrapper", async () => {
    const results = await lint({
      fixture1: `
      import { observeSafely } from "@/server/observability/log";
      const reportConcise = (log: (error: unknown) => void, error: unknown) => observeSafely(() => log(error));
      function handle() { try { run(); } catch (error) { reportConcise(log, error); } }
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);

  it("rejects a local no-op sink and inauthentic wrapper imports", async () => {
    const results = await lint({
      fixture1: `
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
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(5);
  }, budgetMs);

  it("rejects builders, arbitrary imports, aliases, and callback-local parameters as telemetry sinks", async () => {
    const results = await lint({
      fixture1: `
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
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(7);
  }, budgetMs);

  it("rejects empty and non-disposing inline promise rejection handlers", async () => {
    const results = await lint({
      fixture1: `
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
    `,
    }, { rule: "no-silent-catch", options: options });
    const diagnostics = results.fixture1;
    expect(diagnostics).toHaveLength(14);
    expect(diagnostics.filter((diagnostic) => diagnostic.message === messages.empty)).toHaveLength(10);
    expect(diagnostics.filter((diagnostic) => diagnostic.message === messages.silent)).toHaveLength(4);
  }, budgetMs);

  it("rejects TypeScript-wrapped empty and non-disposing inline rejection handlers", async () => {
    const results = await lint({
      fixture1: `
      run().catch((() => {}) as (error: unknown) => void);
      run().catch((() => {}) satisfies (error: unknown) => void);
      run().catch((() => {})!);
      run().catch(<(error: unknown) => void>(() => {}));
      run().then(ok, (() => {}) as (error: unknown) => void);
      run().catch(((error) => { console.log(error); }) as (error: unknown) => void);
      run()["catch"]((() => {}) as (error: unknown) => void);
    `,
    }, { rule: "no-silent-catch", options: options });
    const diagnostics = results.fixture1;
    expect(diagnostics).toHaveLength(7);
    expect(diagnostics.filter((diagnostic) => diagnostic.message === messages.empty)).toHaveLength(6);
    expect(diagnostics.filter((diagnostic) => diagnostic.message === messages.silent)).toHaveLength(1);
  }, budgetMs);

  it("leaves dynamic rejection method keys unclassified", async () => {
    const results = await lint({
      fixture1: `
      run()[method](() => {});
      run()[\`cat\${suffix}\`](() => {});
      run()["cat" + "ch"](() => {});
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);

  it("accepts TypeScript-wrapped inline rejection dispositions", async () => {
    const results = await lint({
      fixture1: `
      run().catch((() => []) as (error: unknown) => unknown);
      run().catch(((error) => { throw error; }) as (error: unknown) => never);
      run().catch((() => undefined) as (error: unknown) => undefined);
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);

  it("preserves cleanup exemptions through TypeScript-wrapped receivers", async () => {
    const results = await lint({
      fixture1: `
      (reader.cancel() as Promise<void>).catch(() => {});
      (iterator.return?.() as Promise<void>).catch(() => {});
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);

  it("preserves retained-fallback parity through TypeScript-wrapped success callbacks and calls", async () => {
    const results = await lint({
      fixture1: `
      async function read() {
        let details = fallback;
        await load().then(((value) => { details = value; }) as (value: string) => void).catch(() => {});
        return details;
      }
    `,
      fixture2: `
      async function read() {
        await load().then(((value) => { details = value; }) as (value: string) => void).catch(() => {});
        if (condition) { var details = fallback; }
        return details;
      }
    `,
      fixture3: `
      async function read() {
        let details = fallback;
        await (run().then(((value) => { details = value; }) as (value: string) => void) as Promise<void>).catch(() => {});
        return details;
      }
    `,
      fixture4: `
      async function read() {
        let details = fallback;
        await (run()["then"](((value) => { details = value; }) as (value: string) => void) as Promise<void>).catch(() => {});
        return details;
      }
    `,
    }, { rule: "no-silent-catch", options: options });
    const before = results.fixture1;
    expect(before).toHaveLength(0);
    const after = results.fixture2;
    expect(after).toHaveLength(1);
    expect(after[0].message).toBe(messages.empty);
    expect(results.fixture3).toHaveLength(0);

    expect(results.fixture4).toHaveLength(0);
  }, budgetMs);

  it("keeps neighbouring promise rejection classifications unchanged", async () => {
    const codes = [
      "run().then(ok).catch(() => {});",
      "run().catch(() => {}).then(ok);",
      "run().catch?.(() => {});",
    ];
    const found = await lint({
      ...Object.fromEntries(codes.map((code, index) => [`neighbour${index}`, code])),
      named: `
      run().catch(handler);
      other().catch(handler);
    `,
      inline: `
      run().catch(() => {});
      other().catch(() => {});
    `,
    }, { rule: "no-silent-catch", options });
    for (const code of codes) {
      const diagnostics = found[`neighbour${codes.indexOf(code)}`];
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).toBe(messages.empty);
    }
    expect(found.named).toHaveLength(0);
    const inline = found.inline;
    expect(inline).toHaveLength(2);
    expect(inline.filter((diagnostic) => diagnostic.message === messages.empty)).toHaveLength(2);
  }, budgetMs);

  it("accepts explicit promise fallbacks, throws, reporting, recovery, and named handlers", async () => {
    const results = await lint({
      fixture1: `
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
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);

  it("rejects outer recovery assignments read before promise settlement", async () => {
    const promises = [
      'run().catch(() => { status = "failed"; })',
      'run().then(ok, () => { status = "failed"; })',
    ];
    const found = await lint(Object.fromEntries(promises.map((promise, index) => [
      `fixture${index}`,
      { path: `fixture${index}.test.ts`, code: `
        let status = "ready";
        ${promise};
        consume(status);
      ` },
    ])), { rule: "no-silent-catch", options: options });
    for (const index of promises.keys()) {
      expect(found[`fixture${index}`]).toHaveLength(1);
      expect(found[`fixture${index}`][0].message).toBe(messages.silent);
    }
  }, budgetMs);

  it("accepts outer recovery assignments read after an awaited rejection handler", async () => {
    const promises = [
      'run().catch(() => { status = "failed"; })',
      'run().then(ok, () => { status = "failed"; })',
      '(run().catch(() => { status = "failed"; }) as Promise<void>).then(ok)',
    ];
    const found = await lint(Object.fromEntries(promises.map((promise, index) => [
      `fixture${index}`,
      { path: `fixture${index}.test.ts`, code: `
        async function read() {
          let status = "ready";
          await ${promise};
          consume(status);
        }
      ` },
    ])), { rule: "no-silent-catch", options: options });
    for (const index of promises.keys()) expect(found[`fixture${index}`]).toHaveLength(0);
  }, budgetMs);

  it("accepts outer recovery assignments read by chained continuations", async () => {
    const chains = [
      '.then(() => consume(status))',
      '.finally(() => consume(status))',
      '.then((() => consume(status)) as () => void)',
      '["then"](() => consume(status))',
    ];
    const found = await lint(Object.fromEntries(chains.map((chain, index) => [
      `fixture${index}`,
      { path: `fixture${index}.test.ts`, code: `
        function read() {
          let status = "ready";
          return run().catch(() => { status = "failed"; })${chain};
        }
      ` },
    ])), { rule: "no-silent-catch", options: options });
    for (const index of chains.keys()) expect(found[`fixture${index}`]).toHaveLength(0);
  }, budgetMs);

  it("does not let a continuation or an await sequence unrelated outer reads", async () => {
    const results = await lint({
      fixture1: `
      let status = "ready";
      run().catch(() => { status = "failed"; }).then(() => work());
      consume(status);
      let outside = "ready";
      async function read() {
        await run().catch(() => { outside = "failed"; });
      }
      consume(outside);
      let returned = "ready";
      function start() { return run().catch(() => { returned = "failed"; }); }
      consume(returned);
      let rejected = "ready";
      run().catch(() => { rejected = "failed"; }).then(ok, () => consume(rejected));
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(4);
  }, budgetMs);

  it("accepts outer recovery assignments read by a closure created after the chain", async () => {
    const results = await lint({
      fixture1: `
      function subscribe() {
        let settled = false;
        run().catch(() => { settled = true; });
        return () => { if (!settled) cleanup(); };
      }
      function nestedDeclaration() {
        let settled = false;
        run().catch(() => { settled = true; });
        return () => {
          function stop() { pending.forEach((item) => { if (!settled) item.cancel(); }); }
          stop();
        };
      }
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);

  it("rejects closures inside the chain statement, outside the calling function, or hoisted", async () => {
    const results = await lint({
      fixture1: `
      let early = "ready";
      schedule(run().catch(() => { early = "failed"; }), () => consume(early));
      let outer = "ready";
      function start() { run().catch(() => { outer = "failed"; }); }
      const read = () => consume(outer);
      function hoisted() {
        read();
        let status = "ready";
        run().catch(() => { status = "failed"; });
        function read() { consume(status); }
      }
      function nestedHoisted() {
        let status = "ready";
        read();
        run().catch(() => { status = "failed"; });
        function read() { (() => consume(status))(); }
      }
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(4);
  }, budgetMs);

  it("requires promise settlement before accepting retained fallback reads", async () => {
    const found = await lint({
      fixture1: { path: "fixture1.test.ts", code: `
      let details = fallback;
      load().then((value) => { details = value; }).catch(() => {});
      consume(details);
    ` },
      fixture2: { path: "fixture2.test.ts", code: `
      let details = fallback;
      load().then((value) => { details = value; }).catch(() => {}).finally(() => consume(details));
    ` },
    }, { rule: "no-silent-catch", options: options });
    expect(found.fixture1).toHaveLength(1);
    expect(found.fixture2).toHaveLength(0);
  }, budgetMs);

  it("exempts iterator and stream cancellation cleanup", async () => {
    const results = await lint({
      fixture1: `
      reader.cancel().catch(() => {});
      reader["cancel"]().catch(() => {});
      request.body.cancel().catch(() => undefined);
      response.body?.cancel().catch(() => {});
      pendingReader.cancel().catch(() => {});
      iterator.return?.().catch(() => {});
      iterator.return?.().then(ok, () => {});
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);

  it("reports cleanup-named methods on receivers that are not streams or iterators", async () => {
    const results = await lint({
      fixture1: `
      payment.cancel().catch(() => {});
      payment["cancel"]().catch(() => {});
      animations.step.cancel().catch((error) => {});
    `,
    }, { rule: "no-silent-catch", options: options });
    expect(results.fixture1).toHaveLength(3);
  }, budgetMs);

  it("applies the same block disposition policy to try catches and promise rejections", async () => {
    const cases = [
      ["", 1, "empty"],
      ["return;", 1, "silent"],
      ["return [];", 0, null],
      ["throw error;", 0, null],
      ["reportClientError(error);", 0, null],
      ["setError('failed');", 0, null],
      ["console.log(error);", 1, "silent"],
    ];
    const found = await lint(Object.fromEntries(cases.flatMap(([body], index) => [
      [`catch${index}`, `import { reportClientError } from "@/client/observability/client-reporter"; async function read() { try { return await run(); } catch (error) { ${body} } }`],
      [`promise${index}`, `import { reportClientError } from "@/client/observability/client-reporter"; async function read() { return await run().catch((error) => { ${body} }); }`],
    ])), { rule: "no-silent-catch", options });
    for (const [index, [, expected, messageId]] of cases.entries()) {
      const catchDiagnostics = found[`catch${index}`];
      const promiseDiagnostics = found[`promise${index}`];
      expect(catchDiagnostics).toHaveLength(expected);
      expect(promiseDiagnostics).toHaveLength(catchDiagnostics.length);
      if (messageId) {
        expect(catchDiagnostics[0].message).toBe(messages[messageId]);
        expect(promiseDiagnostics[0].message).toBe(messages[messageId]);
      }
    }
  }, budgetMs);

  it("keeps retained pre-initialized fallback parity across try and inline promise handlers", async () => {
    const cases = [
      { initializer: "{ code: null }", assignments: "details = value;", readAfter: true, expected: 0 },
      { initializer: "undefined", assignments: "details = value;", readAfter: true, expected: 1 },
      { initializer: "{ code: null }", assignments: "details = value;", readAfter: false, expected: 1 },
      { initializer: "{ code: null }", assignments: "details = undefined; details = value;", readAfter: true, expected: 1 },
    ];
    const fixtures = {};
    for (const [index, { initializer, assignments, readAfter }] of cases.entries()) {
      const ending = readAfter ? "return details;" : "return null;";
      fixtures[`try${index}`] = `
        async function read() {
          let details = ${initializer};
          try { ${assignments.replaceAll("value", "await load()")} } catch {}
          ${ending}
        }
      `;
      for (const [promiseIndex, promise] of [
        `await load().then((value) => { ${assignments} }).catch(() => {});`,
        `await load().then((value) => { ${assignments} }, () => {});`,
      ].entries()) {
        fixtures[`promise${index}-${promiseIndex}`] = `
          async function read() {
            let details = ${initializer};
            ${promise}
            ${ending}
          }
        `;
      }
    }
    const found = await lint(fixtures, { rule: "no-silent-catch", options });
    for (const [index, { expected }] of cases.entries()) {
      const tryDiagnostics = found[`try${index}`];
      expect(tryDiagnostics).toHaveLength(expected);
      for (const promiseIndex of [0, 1]) {
        const promiseDiagnostics = found[`promise${index}-${promiseIndex}`];
        expect(promiseDiagnostics).toHaveLength(expected);
        if (expected) {
          expect(tryDiagnostics[0].message).toBe(messages.empty);
          expect(promiseDiagnostics[0].message).toBe(messages.empty);
        }
      }
    }
  }, budgetMs);

  it("requires the fallback declaration before the protected call and accepts concise success bodies", async () => {
    const promises = [
      "await load().then((value) => details = value).catch(() => {});",
      "await load().then((value) => details = value, () => {});",
    ];
    const fixtures = {};
    for (const [index, promise] of promises.entries()) {
      fixtures[`before${index}`] = `
        async function read() {
          let details = { code: null };
          ${promise}
          return details;
        }
      `;
      fixtures[`after${index}`] = `
        async function read() {
          ${promise}
          if (condition) { var details = { code: null }; }
          return details;
        }
      `;
    }
    const found = await lint(fixtures, { rule: "no-silent-catch", options });
    for (const index of promises.keys()) {
      expect(found[`before${index}`]).toHaveLength(0);
      expect(found[`after${index}`]).toHaveLength(1);
    }
  }, budgetMs);
});

describe("isolate-instrumentation-calls", () => {
  const options = { safeHelpers: ["emitServerEvent"] };

  it("accepts configured intrinsically safe helpers and isolated unsafe helpers", async () => {
    const results = await lint({
      fixture1: `
      import { emitServerEvent, reportClientError } from "@/server/observability/log";
      emitServerEvent(event);
      try { await reportClientError(event); } catch {}
      void reportClientError(event).catch(handleFailure);
      void reportClientError(event)["catch"](handleFailure);
    `,
    }, { rule: "isolate-instrumentation-calls", options: options });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);

  it("rejects unsafe imported instrumentation calls that can escape", async () => {
    const results = await lint({
      fixture1: `
      import { reportClientError } from "@/server/observability/log";
      reportClientError(event);
      try { reportClientError(event); } catch {}
    `,
    }, { rule: "isolate-instrumentation-calls", options: options });
    expect(results.fixture1).toHaveLength(2);
  }, budgetMs);

  it("requires startup reports inside try blocks to be awaited", async () => {
    const results = await lint({
      fixture1: `
      import { sendHomeStartupReport } from "@/client/observability/client-reporter";
      try { sendHomeStartupReport(report); } catch {}
      try { await sendHomeStartupReport(report); } catch {}
    `,
    }, { rule: "isolate-instrumentation-calls", options: options });
    expect(results.fixture1).toHaveLength(1);
  }, budgetMs);
});
