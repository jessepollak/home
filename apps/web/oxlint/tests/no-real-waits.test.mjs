import { afterAll, describe, expect, it } from "bun:test";
import { cp, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const appsWebDir = fileURLToPath(new URL("../..", import.meta.url));
const mirror = await mkdtemp(path.join(tmpdir(), "home-oxlint-no-real-waits-"));
await cp(path.join(appsWebDir, "oxlint"), path.join(mirror, "oxlint"), { recursive: true });
await symlink(path.join(appsWebDir, "node_modules"), path.join(mirror, "node_modules"), "dir");
afterAll(() => rm(mirror, { recursive: true, force: true }));

let fixtureIndex = 0;
async function lint(code, suffix = "pw.ts") {
  fixtureIndex += 1;
  const fixture = `fixture-${fixtureIndex}.${suffix}`;
  const config = `.oxlintrc-${fixtureIndex}.json`;
  await writeFile(path.join(mirror, fixture), code);
  await writeFile(path.join(mirror, config), JSON.stringify({
    plugins: [],
    categories: { correctness: "off" },
    jsPlugins: ["./oxlint/home-plugin.mjs"],
    rules: { "home/no-real-waits": "error" },
  }));
  const result = spawnSync(
    path.join(appsWebDir, "node_modules", ".bin", "oxlint"),
    ["-c", config, "--disable-nested-config", "-f", "json", fixture],
    { cwd: mirror, encoding: "utf8" },
  );
  expect(result.signal).toBeNull();
  expect([0, 1]).toContain(result.status);
  return JSON.parse(result.stdout).diagnostics.filter((diagnostic) =>
    diagnostic.code === "home(no-real-waits)");
}

describe("no-real-waits", () => {
  it("rejects Playwright page and frame sleeps", async () => {
    expect(await lint("page.waitForTimeout(10); frame['waitForTimeout'](20);"))
      .toHaveLength(2);
  });

  it("rejects promise-wrapped timeouts with direct and zero-argument resolver callbacks", async () => {
    expect(await lint(`
      new Promise((resolve) => setTimeout(resolve, delay));
      new Promise(function (done) { setTimeout(done, 1); });
      new Promise((resolve) => setTimeout(() => resolve(), delay));
      new Promise((resolve) => setTimeout(() => { resolve(); }, delay));
    `)).toHaveLength(4);
  });

  it("documents destructured and aliased waitForTimeout as known non-detections", async () => {
    expect(await lint(`
      const { waitForTimeout } = page;
      waitForTimeout(100);
      const browserPage = page;
      browserPage.waitForTimeout(100);
    `)).toHaveLength(0);
  });

  it("accepts observable Playwright waits and unrelated promises", async () => {
    expect(await lint(`
      await expect.poll(readStatus).toBe("ready");
      await page.getByRole("button").waitFor();
      new Promise((resolve) => subscribe(resolve));
    `)).toHaveLength(0);
  });

  const rejectedClocks = [
    ["Date.now call", "Date.now();", 1],
    ["Date call", "Date();", 1],
    ["new Date call", "new Date();", 1],
    ["new Date without parentheses", "new Date;", 1],
    ["performance.now call", "performance.now();", 1],
    ...["globalThis", "window", "self", "global"].map((global) => [
      `${global}-qualified clocks`,
      `${global}.Date.now(); ${global}.Date(); ${global}.performance.now(); new ${global}.Date(); new ${global}.Date;`,
      5,
    ]),
    ["computed members", "Date[\"now\"](); performance[\"now\"]();", 2],
    ["optional calls", "Date.now?.(); performance.now?.();", 2],
    ["uncalled Date.now", "const now = Date.now;", 1],
    ["uncalled performance.now", "[1].map(performance.now);", 1],
    ["uncalled qualified/computed members", "({ now: globalThis.Date[\"now\"], perf: window.performance.now });", 2],
  ];
  for (const [shape, code, count] of rejectedClocks) {
    it(`rejects ${shape}`, async () => {
      const diagnostics = await lint(code, "test.ts");
      expect(diagnostics).toHaveLength(count);
      expect(diagnostics.every((diagnostic) => diagnostic.message.includes("tests must not read the wall clock")))
        .toBe(true);
    });
  }

  it("does not double-count clock calls", async () => {
    expect(await lint(`Date.now(); performance.now();`, "test.ts")).toHaveLength(2);
  });

  it("accepts injected instants and fixed clock functions", async () => {
    expect(await lint(`
      const fixed = new Date("2026-01-01T00:00:00.000Z");
      const now = () => FIXED;
      Date.parse("2026-01-01"); Date.UTC(2026, 0, 1);
      new globalThis.Date(FIXED);
    `, "test.ts")).toHaveLength(0);
  });

  it("accepts local Date and performance bindings but still rejects global clock reads", async () => {
    expect(await lint(`
      Date.now(); performance.now();
      function run(Date, performance) {
        Date.now(); Date(); new Date(); performance.now();
        globalThis.Date.now(); globalThis.performance.now();
      }
    `, "test.ts")).toHaveLength(4);
    expect(await lint(`
      const Date = fakeDate;
      Date.now(); Date(); new Date(); globalThis.Date.now();
    `, "test.ts")).toHaveLength(1);
    expect(await lint(`
      import Date from "./fake-date";
      function run(performance) {
        Date.now(); new Date(); performance.now();
        globalThis.Date.now(); globalThis.performance.now();
      }
    `, "test.ts")).toHaveLength(2);
  });

  it("allows Date reads file-wide with a pinned system clock or fake timers with now", async () => {
    expect(await lint(`
      import { jest } from "bun:test";
      Date.now(); new Date; Date();
      beforeEach(() => jest.setSystemTime(FIXED));
      performance.now();
    `, "test.ts")).toHaveLength(1);
    expect(await lint(`
      import { jest } from "bun:test";
      Date.now(); new Date(); Date();
      jest.useFakeTimers({ now: FIXED });
      performance.now();
    `, "test.ts")).toHaveLength(1);
    expect(await lint(`import { setSystemTime } from "bun:test"; Date.now(); setSystemTime(FIXED);`, "test.ts"))
      .toHaveLength(0);
  });

  it("rejects clock reads in system-time and fake-timer pin arguments file-wide", async () => {
    expect(await lint(`import { setSystemTime } from "bun:test"; setSystemTime(Date.now()); Date.now();`, "test.ts"))
      .toHaveLength(2);
    expect(await lint(`import { setSystemTime } from "bun:test"; setSystemTime(new Date()); new Date();`, "test.ts"))
      .toHaveLength(2);
    expect(await lint(`import { jest } from "bun:test"; jest.useFakeTimers({ now: Date.now() }); Date.now();`, "test.ts"))
      .toHaveLength(2);
    expect(await lint(`import { setSystemTime } from "bun:test"; setSystemTime(Date.now); Date.now();`, "test.ts"))
      .toHaveLength(2);
    expect(await lint(`import { setSystemTime } from "bun:test"; setSystemTime(performance.now() - started); Date.now();`, "test.ts"))
      .toHaveLength(2);
    expect(await lint(`import { setSystemTime } from "bun:test"; setSystemTime(new Date("2026-01-01T00:00:00.000Z")); Date.now();`, "test.ts"))
      .toHaveLength(0);
    expect(await lint(`import { setSystemTime } from "bun:test"; setSystemTime(Date.now()); setSystemTime(FIXED);`, "test.ts"))
      .toHaveLength(1);
    expect(await lint(`import { setSystemTime } from "bun:test"; const instant = Date.now(); setSystemTime(instant); Date.now();`, "test.ts"))
      .toHaveLength(2);
    expect(await lint(`import { jest } from "bun:test"; const start = new Date(); const pin = { now: start }; jest.useFakeTimers(pin); new Date();`, "test.ts"))
      .toHaveLength(2);
    expect(await lint(`import { setSystemTime } from "bun:test"; const FIXED = Date.parse("2026-01-01T00:00:00.000Z"); setSystemTime(FIXED); Date.now();`, "test.ts"))
      .toHaveLength(0);
    expect(await lint(`import { jest, setSystemTime } from "bun:test"; jest.useFakeTimers({ now: FIXED }); const now = Date.now(); const pin = { now }; setSystemTime(pin.now);`, "test.ts"))
      .toHaveLength(1);
    expect(await lint(`import { jest } from "bun:test"; jest.useFakeTimers({ now: FIXED }); const now = Date.now(); expect(now).toBe(FIXED);`, "test.ts"))
      .toHaveLength(0);
  });

  it("keeps unpinned fake timers tied to the wall clock", async () => {
    expect(await lint(`import { jest } from "bun:test"; jest.useFakeTimers(); Date.now(); new Date();`, "test.ts"))
      .toHaveLength(2);
    expect(await lint(`import { jest } from "bun:test"; jest.useFakeTimers({ now: FIXED }); performance.now();`, "test.ts"))
      .toHaveLength(1);
    expect(await lint(`import { jest } from "bun:test"; jest.useFakeTimers({ legacyFakeTimers: true }); Date.now();`, "test.ts"))
      .toHaveLength(1);
  });

  it("allows pinned Playwright page reads but still rejects Node-side Date reads", async () => {
    expect(await lint(`
      Date.now(); new Date();
      await page.clock.install({ time: FIXED });
      await page.evaluate(() => { Date.now(); new Date(); performance.now(); });
      await page.evaluateHandle(function () { return Date(); });
      await page.addInitScript(() => globalThis.Date.now());
      await page.waitForFunction(() => new Date());
      Date.now();
    `)).toHaveLength(4);
    expect(await lint(`
      await page.clock.setFixedTime(FIXED);
      await page.evaluate(() => Date.now());
      Date.now();
    `)).toHaveLength(1);
    expect(await lint(`
      await page.clock.setSystemTime(FIXED);
      await page.evaluate(() => new Date());
      Date.now();
    `)).toHaveLength(1);
    expect(await lint(`await page.evaluate(() => Date.now());`)).toHaveLength(1);
    expect(await lint(`await page.clock.install(); await page.evaluate(() => Date.now());`))
      .toHaveLength(1);
    expect(await lint(`jest.setSystemTime(FIXED); await page.evaluate(() => Date.now());`))
      .toHaveLength(1);
  });

  it("rejects Playwright pin argument reads and does not exempt page callbacks", async () => {
    expect(await lint(`
      await page.clock.install({ time: Date.now() });
      await page.evaluate(() => Date.now());
    `)).toHaveLength(2);
    expect(await lint(`
      await page.clock.setFixedTime(new Date());
      await page.evaluate(() => new Date());
    `)).toHaveLength(2);
    expect(await lint(`
      await page.clock.setSystemTime(new Date());
      await page.evaluate(() => Date.now());
    `)).toHaveLength(2);
    expect(await lint(`
      await page.clock.install({ time: new Date("2026-01-01T00:00:00.000Z") });
      await page.evaluate(() => Date.now());
      Date.now();
    `)).toHaveLength(1);
  });

  it("requires pin callees to resolve to supported test imports", async () => {
    expect(await lint(`fixture.setSystemTime(FIXED); Date.now();`, "test.ts")).toHaveLength(1);
    expect(await lint(`
      const useFakeTimers = (options) => options;
      useFakeTimers({ now: FIXED });
      Date.now();
    `, "test.ts")).toHaveLength(1);
    expect(await lint(`
      function setSystemTime() {}
      setSystemTime(FIXED);
      Date.now();
    `, "test.ts")).toHaveLength(1);
    expect(await lint(`
      const jest = { useFakeTimers: (options) => options };
      jest.useFakeTimers({ now: FIXED });
      Date.now();
    `, "test.ts")).toHaveLength(1);
    expect(await lint(`
      import { setSystemTime } from "./clock-helper";
      setSystemTime(FIXED);
      Date.now();
    `, "test.ts")).toHaveLength(1);
    expect(await lint(`setSystemTime(FIXED); Date.now();`, "test.ts")).toHaveLength(1);
    expect(await lint(`
      import { setSystemTime as pin } from "bun:test";
      pin(FIXED);
      Date.now();
    `, "test.ts")).toHaveLength(0);
    expect(await lint(`
      import { vi } from "vitest";
      vi.setSystemTime(FIXED);
      Date.now();
    `, "test.ts")).toHaveLength(0);
  });

  it("verifies Playwright clock receivers before exempting page reads", async () => {
    expect(await lint(`await fixture.clock.setSystemTime(FIXED); await page.evaluate(() => Date.now());`))
      .toHaveLength(1);
    expect(await lint(`await clock.setSystemTime(FIXED); await page.evaluate(() => Date.now());`))
      .toHaveLength(1);
    expect(await lint(`await page.clock.install({ time: FIXED }); await page.evaluate(() => Date.now());`))
      .toHaveLength(0);
    expect(await lint(`await context.clock.setSystemTime(FIXED); await page.evaluate(() => new Date());`))
      .toHaveLength(0);
  });

  it("honors locally bound clock qualifiers", async () => {
    expect(await lint(`
      const window = fakeGlobals;
      const globalThis = fakeGlobals;
      const self = fakeGlobals;
      window.Date.now(); window.performance.now(); window.Date(); new window.Date;
      globalThis.Date.now(); self.performance.now();
    `, "test.ts")).toHaveLength(0);
    expect(await lint(`
      function run(self) { return self.Date.now(); }
      self.Date.now();
    `, "test.ts")).toHaveLength(1);
  });

  it("treats unpinning arguments as no pin", async () => {
    expect(await lint(`import { setSystemTime } from "bun:test"; setSystemTime(undefined); Date.now();`, "test.ts"))
      .toHaveLength(1);
    expect(await lint(`import { setSystemTime } from "bun:test"; setSystemTime(void 0); Date.now();`, "test.ts"))
      .toHaveLength(1);
    expect(await lint(`import { jest } from "bun:test"; jest.useFakeTimers({ now: undefined }); Date.now();`, "test.ts"))
      .toHaveLength(1);
    expect(await lint(`await page.clock.setSystemTime(undefined); await page.evaluate(() => Date.now());`))
      .toHaveLength(1);
    expect(await lint(`await page.clock.install({ time: undefined }); await page.evaluate(() => Date.now());`))
      .toHaveLength(1);
    expect(await lint(`
      import { jest as testClock } from "bun:test";
      testClock.useFakeTimers({ now: FIXED });
      Date.now();
    `, "test.ts")).toHaveLength(0);
  });

  it("allows direct and const-start performance measurements only", async () => {
    expect(await lint(`
      const started = performance.now();
      const elapsed = performance.now() - started;
      const reversed = started - performance.now();
      const direct = performance.now() - otherStart;
      const unrelated = performance.now();
    `, "test.ts")).toHaveLength(1);
    expect(await lint(`
      let started = performance.now();
      const elapsed = performance.now() - started;
    `, "test.ts")).toHaveLength(1);
    expect(await lint(`
      const started = performance.now();
      function measure(started) { return performance.now() - started; }
    `, "test.ts")).toHaveLength(1);
  });

  it("honors a reasoned oxlint-disable-next-line directive", async () => {
    expect(await lint(`
      // oxlint-disable-next-line home/no-real-waits -- measuring external scheduling
      performance.now();
    `, "test.ts")).toHaveLength(0);
  });
});
