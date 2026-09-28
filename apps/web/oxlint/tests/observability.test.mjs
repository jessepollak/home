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
  const options = { reportingHelpers: ["emitServerEvent", "reportClientError"] };
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
      function unsupported(): never { throw new Error("unsupported"); }
      function unavailable(cause: unknown): never { throw new Error(String(cause)); }
      function observeStoreFailure(code: string): void { emitServerEvent(code); }
      try { run(); } catch { unsupported(); }
      try { run(); } catch (error) { unavailable(error); }
      try { run(); } catch (error) { if (error instanceof Error) throw error; unavailable(error); }
      try { run(); } catch { observeStoreFailure("failed"); }
    `, options)).toHaveLength(0);
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
      try { run(); } catch (error) { (reportClientError as (caught: unknown) => void)(error); }
      run().catch((error) => { (reportClientError as (caught: unknown) => void)(error); });
      function dispose(error: unknown): never { throw error; }
      try { run(); } catch (error) { (dispose as (caught: unknown) => never)(error); }
      run().catch((error) => { (dispose as (caught: unknown) => never)(error); });
    `, options)).toHaveLength(0);
  });

  it("accepts collection cleanup and void-wrapped reporting calls", async () => {
    expect(await lint("no-silent-catch", `
      try { run(); } catch { pending.delete(key); }
      try { run(); } catch (error) { void reportClientError(error); }
    `, options)).toHaveLength(0);
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
        `async function read() { try { return await run(); } catch (error) { ${body} } }`, options);
      const promiseDiagnostics = await lint("no-silent-catch",
        `async function read() { return await run().catch((error) => { ${body} }); }`, options);
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
