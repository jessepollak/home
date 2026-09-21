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

  it("rejects empty catches and null or undefined-only fallbacks", async () => {
    expect(await lint("no-silent-catch", `
      try { run(); } catch {}
      function parse() { try { run(); } catch { return null; } }
      function read() { try { run(); } catch { return undefined; } }
    `, options)).toHaveLength(3);
  });

  it("accepts throws, typed values, reporting, recovery state, and promise settlement", async () => {
    expect(await lint("no-silent-catch", `
      function a() { try { run(); } catch (error) { throw error; } }
      function b() { try { run(); } catch { return { ok: false }; } }
      try { run(); } catch (error) { emitServerEvent(error); }
      try { run(); } catch { setError("failed"); }
      try { run(); } catch { dispatch({ type: "failed" }); }
      try { run(); } catch (error) { reject(error); }
    `, options)).toHaveLength(0);
  });

  it("accepts an outer recovery value only when it is read after the catch", async () => {
    expect(await lint("no-silent-catch", `
      let status = "ready";
      try { run(); } catch { status = "failed"; }
      consume(status);
    `, options)).toHaveLength(0);
  });
});

describe("isolate-instrumentation-calls", () => {
  const options = { safeHelpers: ["emitServerEvent"] };

  it("accepts configured intrinsically safe helpers and isolated unsafe helpers", async () => {
    expect(await lint("isolate-instrumentation-calls", `
      import { emitServerEvent, reportClientError } from "@/server/observability/log";
      emitServerEvent(event);
      try { reportClientError(event); } catch {}
      void reportClientError(event).catch(handleFailure);
    `, options)).toHaveLength(0);
  });

  it("rejects an unsafe imported instrumentation call that can escape", async () => {
    expect(await lint("isolate-instrumentation-calls", `
      import { reportClientError } from "@/server/observability/log";
      reportClientError(event);
    `, options)).toHaveLength(1);
  });
});
