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

  it("accepts collection cleanup and void-wrapped reporting calls", async () => {
    expect(await lint("no-silent-catch", `
      try { run(); } catch { pending.delete(key); }
      try { run(); } catch (error) { void reportClientError(error); }
    `, options)).toHaveLength(0);
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
