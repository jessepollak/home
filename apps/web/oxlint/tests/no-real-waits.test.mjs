import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { describe, expect, it } from "bun:test";
import { budgetMs, createOxlintWorkspace } from "./helpers/oxlint-workspace.mjs";
applyRuleCheckTimeout();

const { lint } = await createOxlintWorkspace("home-oxlint-no-real-waits-", {
  path: (name) => `${name}.pw.ts`,
  rules: ["no-real-waits"],
});

describe("no-real-waits", () => {
  it("rejects Playwright page and frame sleeps", async () => {
    const results = await lint({
      fixture1: "page.waitForTimeout(10); frame['waitForTimeout'](20);",
    });
    expect(results.fixture1)
      .toHaveLength(2);
  }, budgetMs);

  it("rejects promise-wrapped timeouts with direct and zero-argument resolver callbacks", async () => {
    const results = await lint({
      fixture1: `
      new Promise((resolve) => setTimeout(resolve, delay));
      new Promise(function (done) { setTimeout(done, 1); });
      new Promise((resolve) => setTimeout(() => resolve(), delay));
      new Promise((resolve) => setTimeout(() => { resolve(); }, delay));
    `,
    });
    expect(results.fixture1).toHaveLength(4);
  }, budgetMs);

  it("documents destructured and aliased waitForTimeout as known non-detections", async () => {
    const results = await lint({
      fixture1: `
      const { waitForTimeout } = page;
      waitForTimeout(100);
      const browserPage = page;
      browserPage.waitForTimeout(100);
    `,
    });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);

  it("accepts observable Playwright waits and unrelated promises", async () => {
    const results = await lint({
      fixture1: `
      await expect.poll(readStatus).toBe("ready");
      await page.getByRole("button").waitFor();
      new Promise((resolve) => subscribe(resolve));
    `,
    });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);

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
    ["aliased Date object", "const Clock = Date; Clock.now(); Clock(); new Clock();", 3],
    ["destructured Date.now", "const { now } = Date; now();", 1],
    ["aliased performance object", "const clock = performance; clock.now();", 1],
    ["destructured performance.now", "const { now: readTime } = performance; readTime();", 1],
    ["defaulted destructured Date.now", "const { now = () => 0 } = Date; now();", 1],
    ["defaulted destructured performance.now", "const { now = () => 0 } = performance; now();", 1],
    ["renamed defaulted clock bindings", "const { now: dateNow = () => 0 } = Date; const { now: perfNow = () => 0 } = performance; dateNow(); perfNow();", 2],
    ["qualified clock aliases", "const Clock = globalThis.Date; const { now } = window.performance; Clock.now(); now();", 2],
    ["chained clock aliases", "const Clock = Date; const OtherClock = Clock; const { now } = OtherClock; now();", 1],
    ["uncalled destructured clock reference", "const { now } = Date; const read = { now };", 1],
  ];
  for (const [shape, code, count] of rejectedClocks) {
    it(`rejects ${shape}`, async () => {
      const results = await lint({
        fixture1: { path: "fixture1.test.ts", code },
      });
      const diagnostics = results.fixture1;
      expect(diagnostics).toHaveLength(count);
      expect(diagnostics.every((diagnostic) => diagnostic.message.includes("tests must not read the wall clock")))
        .toBe(true);
    }, budgetMs);
  }

  it("does not double-count clock calls", async () => {
    const results = await lint({
      fixture1: { path: "fixture1.test.ts", code: `Date.now(); performance.now();` },
    });
    expect(results.fixture1).toHaveLength(2);
  }, budgetMs);

  it("accepts injected instants and fixed clock functions", async () => {
    const results = await lint({
      fixture1: { path: "fixture1.test.ts", code: `
      const fixed = new Date("2026-01-01T00:00:00.000Z");
      const now = () => FIXED;
      Date.parse("2026-01-01"); Date.UTC(2026, 0, 1);
      new globalThis.Date(FIXED);
    ` },
    });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);

  it("accepts local Date and performance bindings but still rejects global clock reads", async () => {
    const results = await lint({
      fixture1: { path: "fixture1.test.ts", code: `
      Date.now(); performance.now();
      function run(Date, performance) {
        Date.now(); Date(); new Date(); performance.now();
        globalThis.Date.now(); globalThis.performance.now();
      }
    ` },
      fixture2: { path: "fixture2.test.ts", code: `
      const Date = fakeDate;
      Date.now(); Date(); new Date(); globalThis.Date.now();
    ` },
      fixture3: { path: "fixture3.test.ts", code: `
      import Date from "./fake-date";
      function run(performance) {
        Date.now(); new Date(); performance.now();
        globalThis.Date.now(); globalThis.performance.now();
      }
    ` },
    });
    expect(results.fixture1).toHaveLength(4);
    expect(results.fixture2).toHaveLength(1);
    expect(results.fixture3).toHaveLength(2);
  }, budgetMs);

  it("keeps aliases of shadowed clock objects clean", async () => {
    const results = await lint({
      fixture1: { path: "fixture1.test.ts", code: `
      function run(Date, performance, globalThis) {
        const Clock = Date; const { now } = Clock; Clock.now(); now(); new Clock();
        const timer = performance; const { now: readTime } = timer; readTime(); timer.now();
        const QualifiedClock = globalThis.Date; QualifiedClock.now();
        const { now: dateNow = () => 0 } = Date; dateNow();
        const { now: perfNow = () => 0 } = performance; perfNow();
      }
    ` },
    });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);

  it("allows Date reads only in scopes governed by a pinned system clock or fake timers with now", async () => {
    const results = await lint({
      fixture1: { path: "fixture1.test.ts", code: `
      import { jest } from "bun:test";
      Date.now(); new Date; Date();
      beforeEach(() => jest.setSystemTime(FIXED));
      performance.now();
    ` },
      fixture2: { path: "fixture2.test.ts", code: `
      import { jest } from "bun:test";
      Date.now(); new Date(); Date();
      jest.useFakeTimers({ now: FIXED });
      performance.now();
    ` },
      fixture3: { path: "fixture3.test.ts", code: `import { setSystemTime } from "bun:test"; Date.now(); setSystemTime(FIXED);` },
    });
    expect(results.fixture1).toHaveLength(4);
    expect(results.fixture2).toHaveLength(1);
    expect(results.fixture3)
      .toHaveLength(0);
  }, budgetMs);

  it("applies fixed pins to aliased Date reads but not performance reads", async () => {
    const results = await lint({
      fixture1: { path: "fixture1.test.ts", code: `
      import { setSystemTime } from "bun:test";
      const Clock = Date; const { now } = Clock;
      setSystemTime(FIXED); Clock.now(); now(); new Clock();
      const timer = performance; timer.now();
    ` },
    });
    expect(results.fixture1).toHaveLength(1);
  }, budgetMs);

  it("reports an unpinned sibling test but allows reads in the pinning test", async () => {
    const wrappers = ["CALLBACK as () => void", "CALLBACK satisfies () => void", "CALLBACK!",
      "<() => void>CALLBACK", "(CALLBACK)", "(CALLBACK as () => void)!"];
    const wrap = (wrapper, callback) => wrapper.replace("CALLBACK", `(${callback})`);
    const results = await lint({
      fixture1: { path: "fixture1.test.ts", code: `
      import { setSystemTime } from "bun:test";
      test("pinned", () => { setSystemTime(FIXED); Date.now(); new Date(); Date(); });
      test("unpinned", () => Date.now());
      ${wrappers.map((wrapper) => `
        test("pinned", ${wrap(wrapper, "() => { setSystemTime(FIXED); Date.now(); }")});
        test("unpinned", ${wrap(wrapper, "() => Date.now()")});
        describe("governed", ${wrap(wrapper, `() => {
          beforeEach(${wrap(wrapper, "() => { setSystemTime(FIXED); Date.now(); }")});
          test("local", ${wrap(wrapper, "() => Date.now()")});
        }`)});
      `).join("\n")}
      Date.now();
    ` },
    });
    expect(results.fixture1).toHaveLength(wrappers.length + 2);
  }, budgetMs);

  it("allows pre-hook governed reads without covering earlier hooks at any nesting depth", async () => {
    const hooks = ["beforeEach", "beforeAll", "before", "test.beforeEach", "it.beforeAll"];
    const earlyHooks = ["beforeAll", "before"];
    const results = await lint({
      fixture1: { path: "fixture1.test.ts", code: `
      import { setSystemTime } from "bun:test";
      ${hooks.map((hook) => `
        describe("${hook}", () => {
          ${hook}(() => { setSystemTime(FIXED); Date.now(); });
          test("outer", () => Date.now());
          afterEach(() => Date.now());
          describe("nested", () => {
            test("inner", function () { return new Date(); });
            beforeEach(() => Date.now());
          });
        });
      `).join("\n")}
      ${earlyHooks.map((hook) => `
        describe("beforeEach pin", () => {
          beforeEach(() => { setSystemTime(FIXED); Date.now(); });
          ${hook}(() => Date.now());
          test("governed", () => Date.now());
          afterEach(() => Date.now());
          afterAll(() => Date.now());
          after(() => Date.now());
          describe("nested", () => ${hook}(() => Date.now()));
          describe("deeper", () => describe("deepest", () => ${hook}(() => Date.now())));
        });
        describe("${hook} pin", () => {
          ${hook}(() => { setSystemTime(FIXED); Date.now(); });
          beforeAll(() => Date.now());
          before(() => Date.now());
          beforeEach(() => Date.now());
          test("governed", () => Date.now());
        });
      `).join("\n")}
    ` },
    });
    expect(results.fixture1).toHaveLength(earlyHooks.length * 3);
  }, budgetMs);

  it("recognizes named beforeEach callbacks declared as functions or const bindings", async () => {
    const declarations = [
      "function pinClock() { setSystemTime(FIXED); }",
      "const pinClock = () => setSystemTime(FIXED);",
      "const pinClock = function () { setSystemTime(FIXED); };",
    ];
    const found = await lint(Object.fromEntries(declarations.map((declaration, index) => [
      `fixture${index}`,
      { path: `fixture${index}.test.ts`, code: `
        import { setSystemTime } from "bun:test";
        ${declaration}
        describe("governed", () => {
          beforeEach(pinClock);
          it("reads", () => Date.now());
        });
      ` },
    ])));
    for (const index of declarations.keys()) expect(found[`fixture${index}`]).toHaveLength(0);
  }, budgetMs);

  it("allows named tests with their own pin without exempting unpinned named siblings", async () => {
    const results = await lint({
      fixture1: { path: "fixture1.test.ts", code: `
      import { setSystemTime } from "bun:test";
      function readsA() { setSystemTime(FIXED); Date.now(); }
      const readsB = () => Date.now();
      const readsC = function () { setSystemTime(FIXED); new Date(); };
      function readsD() { return Date.now(); }
      it("pinned declaration", readsA);
      it("unpinned const", readsB);
      it("pinned const", readsC);
      it("unpinned declaration", readsD);
    ` },
    });
    expect(results.fixture1).toHaveLength(2);
  }, budgetMs);

  it("reports named callbacks that are also invoked or escaped outside registration", async () => {
    const declarations = [
      "function read() { Date.now(); }",
      "const read = () => Date.now();",
      "const read = function () { Date.now(); };",
    ];
    const otherUses = ["read();", 'it("unpinned", () => read());', "consume(read);", "const alias = read;"];
    const cases = declarations.flatMap((declaration, declarationIndex) =>
      otherUses.map((otherUse, useIndex) => ({ name: `fixture${declarationIndex}_${useIndex}`, declaration, otherUse })));
    const found = await lint(Object.fromEntries(cases.map(({ name, declaration, otherUse }) => [
      name,
      { path: `${name}.test.ts`, code: `
          import { vi } from "vitest";
          ${declaration}
          describe("pinned", () => {
            beforeEach(() => vi.setSystemTime(0));
            it("read", read);
          });
          ${otherUse}
        ` },
    ])));
    for (const { name } of cases) expect(found[name]).toHaveLength(1);
  }, budgetMs);

  it("requires exactly one governed registration for a named callback", async () => {
    const registrations = [
      ["", 0],
      ['describe("also pinned", () => { beforeEach(() => vi.setSystemTime(0)); it("read", read); });', 1],
      ['it("unpinned", read);', 1],
    ];
    const found = await lint(Object.fromEntries(registrations.map(([otherRegistration], index) => [
      `fixture${index}`,
      { path: `fixture${index}.test.ts`, code: `
        import { vi } from "vitest";
        function read() { Date.now(); }
        describe("pinned", () => {
          beforeEach(() => vi.setSystemTime(0));
          it("read", read as () => void);
        });
        ${otherRegistration}
      ` },
    ])));
    for (const [index, [, expected]] of registrations.entries()) expect(found[`fixture${index}`]).toHaveLength(expected);
  }, budgetMs);

  it("allows pre-hooks inside named suite callbacks to govern their tests", async () => {
    const declarations = [
      'function suite() { beforeEach(() => vi.setSystemTime(0)); it("read", () => Date.now()); }',
      'const suite = () => { beforeEach(() => vi.setSystemTime(0)); it("read", () => Date.now()); };',
      'const suite = function () { beforeEach(() => vi.setSystemTime(0)); it("read", () => Date.now()); };',
    ];
    const found = await lint(Object.fromEntries(declarations.map((declaration, index) => [
      `fixture${index}`,
      { path: `fixture${index}.test.ts`, code: `
        import { vi } from "vitest";
        ${declaration}
        describe("suite", suite);
      ` },
    ])));
    for (const index of declarations.keys()) expect(found[`fixture${index}`]).toHaveLength(0);
  }, budgetMs);

  it("reports multiply registered suites and descendant beforeAll reads under beforeEach", async () => {
    const found = await lint({
      fixture1: { path: "fixture1.test.ts", code: `
      import { vi } from "vitest";
      function suite() { it("read", () => Date.now()); }
      describe("outer", () => {
        beforeEach(() => vi.setSystemTime(0));
        describe("inner", suite);
      });
      describe("unpinned", suite);
    ` },
      fixture2: { path: "fixture2.test.ts", code: `
      import { vi } from "vitest";
      const pin = () => vi.setSystemTime(0);
      function inner() { beforeAll(() => Date.now()); }
      describe("outer", () => {
        beforeEach(pin);
        describe("inner", inner);
      });
    ` },
    });
    expect(found.fixture1).toHaveLength(1);
    expect(found.fixture2).toHaveLength(1);
  }, budgetMs);

  it("keeps escaped callback pins local instead of promoting them to program scope", async () => {
    const declarations = [
      "function pin() { vi.setSystemTime(0); Date.now(); }",
      "const pin = () => { vi.setSystemTime(0); Date.now(); };",
      "const pin = function localPin() { vi.setSystemTime(0); Date.now(); };",
      "const pin = (() => { vi.setSystemTime(0); Date.now(); }) as () => void;",
    ];
    const registrations = ['beforeEach(pin);', 'it("pin", pin);'];
    const cases = declarations.flatMap((declaration, declarationIndex) =>
      registrations.map((registration, registrationIndex) => ({ name: `fixture${declarationIndex}_${registrationIndex}`, declaration, registration })));
    const found = await lint(Object.fromEntries(cases.map(({ name, declaration, registration }) => [
      name,
      { path: `${name}.test.ts`, code: `
          import { vi } from "vitest";
          ${declaration}
          ${registration}
          const saved = pin;
          Date.now();
        ` },
    ])));
    for (const { name } of cases) expect(found[name]).toHaveLength(1);
  }, budgetMs);

  it("does not apply enclosing pins to escaped callbacks", async () => {
    const results = await lint({
      fixture1: { path: "fixture1.test.ts", code: `
      import { vi } from "vitest";
      vi.setSystemTime(0);
      describe("pinned", () => {
        beforeEach(() => vi.setSystemTime(0));
        function read() { Date.now(); }
        it("read", read);
        read();
      });
    ` },
    });
    expect(results.fixture1).toHaveLength(1);
  }, budgetMs);

  it("resolves registered callback declarations despite inner name shadows", async () => {
    const declarations = [
      "function read() { const read = 1; consume(read); Date.now(); }",
      "function read(read) { consume(read); Date.now(); }",
      "function read() { var read = 1; consume(read); Date.now(); }",
      "const read = function read() { const read = 1; consume(read); Date.now(); };",
      "const read = function read(read) { consume(read); Date.now(); };",
      "const read = function read() { var read = 1; consume(read); Date.now(); };",
    ];
    const found = await lint(Object.fromEntries(declarations.map((declaration, index) => [
      `fixture${index}`,
      { path: `fixture${index}.test.ts`, code: `
        import { vi } from "vitest";
        beforeEach(() => vi.setSystemTime(0));
        ${declaration}
        it("read", read);
      ` },
    ])));
    for (const index of declarations.keys()) expect(found[`fixture${index}`]).toHaveLength(0);
  }, budgetMs);

  it("treats recursive callback references conservatively", async () => {
    const declarations = [
      "function read() { Date.now(); read(); }",
      "const read = () => { Date.now(); read(); };",
      "const read = function recurse() { Date.now(); recurse(); };",
    ];
    const found = await lint(Object.fromEntries(declarations.map((declaration, index) => [
      `fixture${index}`,
      { path: `fixture${index}.test.ts`, code: `
        import { vi } from "vitest";
        beforeEach(() => vi.setSystemTime(0));
        ${declaration}
        it("read", read);
      ` },
    ])));
    for (const index of declarations.keys()) expect(found[`fixture${index}`]).toHaveLength(1);
  }, budgetMs);

  it("follows single named suite ancestry including a named pin hook", async () => {
    const found = await lint({
      fixture1: { path: "fixture1.test.ts", code: `
      import { vi } from "vitest";
      function pin() { vi.setSystemTime(0); }
      function suite() { beforeEach(pin); it("read", () => Date.now()); }
      function outer() { describe("inner", suite); }
      describe("outer", outer);
    ` },
      fixture2: { path: "fixture2.test.ts", code: `
      import { vi } from "vitest";
      function suite() { it("read", () => Date.now()); }
      function outer() { describe("inner", suite); }
      describe("pinned", () => {
        beforeEach(() => vi.setSystemTime(0));
        describe("outer", outer);
      });
    ` },
    });
    expect(found.fixture1).toHaveLength(0);
    expect(found.fixture2).toHaveLength(0);
  }, budgetMs);

  it("reports branching named suite registrations without enumerating their paths", async () => {
    const suites = Array.from({ length: 24 }, (_, index) => `
      function suite${index + 1}() {
        describe("left", suite${index});
        describe("right", suite${index});
      }
    `).join("\n");
    const results = await lint({
      fixture1: { path: "fixture1.test.ts", code: `
      import { vi } from "vitest";
      function suite0() { it("read", () => Date.now()); }
      ${suites}
      describe("pinned", () => {
        beforeEach(() => vi.setSystemTime(0));
        describe("branching", suite24);
      });
    ` },
    });
    expect(results.fixture1).toHaveLength(1);
  }, budgetMs);

  it("does not let a describe hook exempt a sibling describe or ancestor test", async () => {
    const results = await lint({
      fixture1: { path: "fixture1.test.ts", code: `
      import { setSystemTime } from "bun:test";
      describe("pinned", () => {
        beforeEach(() => setSystemTime(FIXED));
        test("local", () => Date.now());
        describe("nested", () => test("inner", () => Date.now()));
      });
      describe("unpinned", () => test("sibling", () => Date.now()));
      test("ancestor", () => Date.now());
    ` },
    });
    expect(results.fixture1).toHaveLength(2);
  }, budgetMs);

  it("does not let top-level pre-hooks exempt program or describe scope reads", async () => {
    const results = await lint({
      fixture1: { path: "fixture1.test.ts", code: `
      import { setSystemTime } from "bun:test";
      beforeEach(() => setSystemTime(FIXED));
      Date.now();
      function helper() { return new Date(); }
      const otherHelper = () => Date();
      describe("suite", () => { Date.now(); test("governed", () => Date.now()); });
    ` },
    });
    expect(results.fixture1).toHaveLength(4);
  }, budgetMs);

  it("does not let a program pin exempt a test or hook callback", async () => {
    const results = await lint({
      fixture1: { path: "fixture1.test.ts", code: `
      import { setSystemTime } from "bun:test";
      setSystemTime(FIXED);
      Date.now();
      test("unpinned", () => Date.now());
      beforeEach(() => Date.now());
    ` },
    });
    expect(results.fixture1).toHaveLength(2);
  }, budgetMs);

  it("allows post-hook reads only in the pinning hook", async () => {
    const hooks = ["afterEach", "afterAll", "after", "test.afterEach", "it.afterAll"];
    const results = await lint({
      fixture1: { path: "fixture1.test.ts", code: `
      import { setSystemTime } from "bun:test";
      ${hooks.map((hook) => `
        ${hook}(() => { setSystemTime(FIXED); Date.now(); });
      `).join("\n")}
      Date.now();
      beforeEach(() => Date.now());
    ` },
    });
    expect(results.fixture1).toHaveLength(2);
  }, budgetMs);

  it("recognizes modified test callbacks and skips non-callback functions", async () => {
    const testCalls = ["test", "it", "test.only", "it.skip", "test.todo", "test.fixme",
      "test.fail", "test.slow", "test.concurrent", "test.sequential", "test.each",
      "test.each([1])", "test.each`value\n${1}`", "it.concurrent.only", "(test as typeof test).only",
      "test.skipIf(true)", "test.runIf(true)", "test.if(true)", "test.todoIf(true)", "test.failIf(true)",
      "test.fails", "test.failsIf(true)", "test.for([1])"];
    const results = await lint({
      fixture1: { path: "fixture1.test.ts", code: `
      import { jest } from "bun:test";
      ${testCalls.map((testCall) => `
        ${testCall}("pinned", function () {
          (() => jest.useFakeTimers({ now: FIXED }))();
          [1].map(() => Date.now());
        });
      `).join("\n")}
      Date.now();
    ` },
    });
    expect(results.fixture1).toHaveLength(1);
  }, budgetMs);

  it("recognizes describe containers and aliased framework scopes", async () => {
    const containers = ["describe", "describe.only", "describe.skip", "describe.each",
      "describe.each([1])", "describe.each`value\n${1}`", "describe.runIf(true)", "describe.skipIf(true)",
      "test.describe", "test.describe.only", "test.describe.serial", "test.describe.parallel",
      "describe.concurrent", "describe.sequential", "describe.shuffle", "describe.todo"];
    const frameworks = ["bun:test", "vitest", "@jest/globals"];
    const frameworkFixtures = {};
    for (const [index, framework] of frameworks.entries()) {
      frameworkFixtures[`framework${index}`] = { path: `framework${index}.test.ts`, code: `
        import { setSystemTime } from "bun:test";
        import { test as case${index}, describe as suite${index}, beforeEach as setup${index} } from "${framework}";
        suite${index}.only("governed", () => {
          setup${index}(() => setSystemTime(FIXED));
          case${index}.only("local", () => Date.now());
          suite${index}("nested", () => case${index}("inner", () => Date.now()));
        });
        suite${index}("sibling", () => case${index}("unpinned", () => Date.now()));
        case${index}("pinned", () => { setSystemTime(FIXED); Date.now(); });
        case${index}.skip("unpinned", () => Date.now());
        suite${index}("body pin", () => { setSystemTime(FIXED); Date.now(); });
        suite${index}.only("unpinned body", () => Date.now());
      ` };
    }
    const results = await lint({
      fixture1: { path: "fixture1.test.ts", code: `
      import { setSystemTime } from "bun:test";
      ${containers.map((container) => `
        ${container}("pinned", () => {
          beforeAll(() => setSystemTime(FIXED));
          it("local", () => Date.now());
        });
      `).join("\n")}
      describe("sibling", () => it("unpinned", () => Date.now()));
      import { test as browserTest } from "@playwright/test";
      browserTest.describe.serial("governed", () => {
        browserTest.beforeEach(() => setSystemTime(FIXED));
        browserTest.only("local", () => Date.now());
        browserTest.describe("nested", () => browserTest("inner", () => Date.now()));
      });
      browserTest.describe.parallel("sibling", () => browserTest("unpinned", () => Date.now()));
      browserTest("pinned", () => { setSystemTime(FIXED); Date.now(); });
      browserTest.skip("unpinned", () => Date.now());
      Date.now();
    ` },
      ...frameworkFixtures,
    });
    expect(results.fixture1).toHaveLength(4);
    for (const index of frameworks.keys()) {
      expect(results[`framework${index}`]).toHaveLength(3);
    }
  }, budgetMs);

  it("uses only the last function argument as a test callback", async () => {
    const results = await lint({
      fixture1: { path: "fixture1.test.ts", code: `
      import { setSystemTime } from "bun:test";
      test("callbacks", () => setSystemTime(FIXED), () => Date.now());
    ` },
    });
    expect(results.fixture1).toHaveLength(1);
  }, budgetMs);

  it("does not recognize computed or unrelated test modifiers", async () => {
    const results = await lint({
      fixture1: { path: "fixture1.test.ts", code: `
      import { setSystemTime } from "bun:test";
      test["only"]("not a scope", () => setSystemTime(FIXED));
      fixture.only("not a scope", () => setSystemTime(FIXED));
      test("unpinned", () => Date.now());
    ` },
    });
    expect(results.fixture1).toHaveLength(1);
  }, budgetMs);

  it("keeps invalid pin sources reported even when a pre-hook governs their test", async () => {
    const results = await lint({
      fixture1: { path: "fixture1.test.ts", code: `
      import { setSystemTime } from "bun:test";
      beforeEach(() => setSystemTime(FIXED));
      test("invalid", () => { setSystemTime(Date.now()); Date.now(); });
    ` },
    });
    expect(results.fixture1).toHaveLength(1);
  }, budgetMs);

  it("rejects clock reads in system-time and fake-timer pin arguments file-wide", async () => {
    const results = await lint({
      fixture1: { path: "fixture1.test.ts", code: `import { setSystemTime } from "bun:test"; setSystemTime(Date.now()); Date.now();` },
      fixture2: { path: "fixture2.test.ts", code: `import { setSystemTime } from "bun:test"; setSystemTime(new Date()); new Date();` },
      fixture3: { path: "fixture3.test.ts", code: `import { jest } from "bun:test"; jest.useFakeTimers({ now: Date.now() }); Date.now();` },
      fixture4: { path: "fixture4.test.ts", code: `import { setSystemTime } from "bun:test"; setSystemTime(Date.now); Date.now();` },
      fixture5: { path: "fixture5.test.ts", code: `import { setSystemTime } from "bun:test"; setSystemTime(performance.now() - started); Date.now();` },
      fixture6: { path: "fixture6.test.ts", code: `import { setSystemTime } from "bun:test"; setSystemTime(new Date("2026-01-01T00:00:00.000Z")); Date.now();` },
      fixture7: { path: "fixture7.test.ts", code: `import { setSystemTime } from "bun:test"; setSystemTime(Date.now()); setSystemTime(FIXED);` },
      fixture8: { path: "fixture8.test.ts", code: `import { setSystemTime } from "bun:test"; const instant = Date.now(); setSystemTime(instant); Date.now();` },
      fixture9: { path: "fixture9.test.ts", code: `import { jest } from "bun:test"; const start = new Date(); const pin = { now: start }; jest.useFakeTimers(pin); new Date();` },
      fixture10: { path: "fixture10.test.ts", code: `import { setSystemTime } from "bun:test"; const FIXED = Date.parse("2026-01-01T00:00:00.000Z"); setSystemTime(FIXED); Date.now();` },
      fixture11: { path: "fixture11.test.ts", code: `import { jest, setSystemTime } from "bun:test"; jest.useFakeTimers({ now: FIXED }); const now = Date.now(); const pin = { now }; setSystemTime(pin.now);` },
      fixture12: { path: "fixture12.test.ts", code: `import { jest } from "bun:test"; jest.useFakeTimers({ now: FIXED }); const now = Date.now(); expect(now).toBe(FIXED);` },
    });
    expect(results.fixture1)
      .toHaveLength(2);
    expect(results.fixture2)
      .toHaveLength(2);
    expect(results.fixture3)
      .toHaveLength(2);
    expect(results.fixture4)
      .toHaveLength(2);
    expect(results.fixture5)
      .toHaveLength(2);
    expect(results.fixture6)
      .toHaveLength(0);
    expect(results.fixture7)
      .toHaveLength(1);
    expect(results.fixture8)
      .toHaveLength(2);
    expect(results.fixture9)
      .toHaveLength(2);
    expect(results.fixture10)
      .toHaveLength(0);
    expect(results.fixture11)
      .toHaveLength(1);
    expect(results.fixture12)
      .toHaveLength(0);
  }, budgetMs);

  it("keeps unpinned fake timers tied to the wall clock", async () => {
    const results = await lint({
      fixture1: { path: "fixture1.test.ts", code: `import { jest } from "bun:test"; jest.useFakeTimers(); Date.now(); new Date();` },
      fixture2: { path: "fixture2.test.ts", code: `import { jest } from "bun:test"; jest.useFakeTimers({ now: FIXED }); performance.now();` },
      fixture3: { path: "fixture3.test.ts", code: `import { jest } from "bun:test"; jest.useFakeTimers({ legacyFakeTimers: true }); Date.now();` },
    });
    expect(results.fixture1)
      .toHaveLength(2);
    expect(results.fixture2)
      .toHaveLength(1);
    expect(results.fixture3)
      .toHaveLength(1);
  }, budgetMs);

  it("rejects fake-timer pins that trailing spreads or duplicate properties can override", async () => {
    const overridden = ["{ now: FIXED, ...options }", "{ now: FIXED, now: undefined }", "{ now: FIXED, [key]: other }"];
    const kept = ["{ ...options, now: FIXED }", "{ now: undefined, now: FIXED }", "{ now: FIXED, other: options }"];
    const spreads = [...overridden, ...kept];
    const found = await lint(Object.fromEntries(spreads.map((spread, index) => [
      `fixture${index}`,
      { path: `fixture${index}.test.ts`, code: `import { vi } from "vitest"; vi.useFakeTimers(${spread}); Date.now();` },
    ])));
    for (const index of overridden.keys()) expect(found[`fixture${index}`]).toHaveLength(1);
    for (const index of kept.keys()) expect(found[`fixture${index + overridden.length}`]).toHaveLength(0);
  }, budgetMs);

  it("rejects Playwright install pins overridden after time but accepts final fixed time", async () => {
    const found = await lint({
      fixture1: `await page.clock.install({ time: FIXED, ...options }); await page.evaluate(() => Date.now());`,
      fixture2: `await page.clock.install({ time: FIXED, time: undefined }); await page.evaluate(() => Date.now());`,
      fixture3: `await page.clock.install({ ...options, time: FIXED }); await page.evaluate(() => Date.now());`,
    });
    expect(found.fixture1).toHaveLength(1);
    expect(found.fixture2).toHaveLength(1);
    expect(found.fixture3).toHaveLength(0);
  }, budgetMs);

  it("allows pinned Playwright page reads but still rejects Node-side Date reads", async () => {
    const results = await lint({
      fixture1: `
      Date.now(); new Date();
      await page.clock.install({ time: FIXED });
      await page.evaluate(() => { Date.now(); new Date(); performance.now(); });
      await page.evaluateHandle(function () { return Date(); });
      await page.addInitScript(() => globalThis.Date.now());
      await page.waitForFunction(() => new Date());
      Date.now();
    `,
      fixture2: `
      await page.clock.setFixedTime(FIXED);
      await page.evaluate(() => Date.now());
      Date.now();
    `,
      fixture3: `
      await page.clock.setSystemTime(FIXED);
      await page.evaluate(() => new Date());
      Date.now();
    `,
      fixture4: `await page.evaluate(() => Date.now());`,
      fixture5: `await page.clock.install(); await page.evaluate(() => Date.now());`,
      fixture6: `jest.setSystemTime(FIXED); await page.evaluate(() => Date.now());`,
    });
    expect(results.fixture1).toHaveLength(4);
    expect(results.fixture2).toHaveLength(1);
    expect(results.fixture3).toHaveLength(1);
    expect(results.fixture4).toHaveLength(1);
    expect(results.fixture5)
      .toHaveLength(1);
    expect(results.fixture6)
      .toHaveLength(1);
  }, budgetMs);

  it("does not let a Playwright test pin exempt a sibling page callback", async () => {
    const results = await lint({
      fixture1: { code: `
      test("pinned", async ({ page }) => {
        await page.clock.setFixedTime(FIXED);
        await page.evaluate(() => Date.now());
      });
      test("unpinned", async ({ page }) => {
        await page.evaluate(() => Date.now());
      });
    ` },
    });
    expect(results.fixture1).toHaveLength(1);
  }, budgetMs);

  it("allows Playwright page reads governed by a pinning beforeEach but not Node reads", async () => {
    const results = await lint({
      fixture1: { code: `
      test.beforeEach(async ({ page }) => { await page.clock.install({ time: FIXED }); });
      test("outer", async ({ page }) => {
        await page.evaluate(() => Date.now());
        Date.now();
      });
      test.describe("nested", () => {
        test("inner", async ({ page }) => { await page.evaluate(() => new Date()); });
      });
    ` },
    });
    expect(results.fixture1).toHaveLength(1);
  }, budgetMs);

  it("rejects Playwright pin argument reads and does not exempt page callbacks", async () => {
    const results = await lint({
      fixture1: `
      await page.clock.install({ time: Date.now() });
      await page.evaluate(() => Date.now());
    `,
      fixture2: `
      await page.clock.setFixedTime(new Date());
      await page.evaluate(() => new Date());
    `,
      fixture3: `
      await page.clock.setSystemTime(new Date());
      await page.evaluate(() => Date.now());
    `,
      fixture4: `
      await page.clock.install({ time: new Date("2026-01-01T00:00:00.000Z") });
      await page.evaluate(() => Date.now());
      Date.now();
    `,
    });
    expect(results.fixture1).toHaveLength(2);
    expect(results.fixture2).toHaveLength(2);
    expect(results.fixture3).toHaveLength(2);
    expect(results.fixture4).toHaveLength(1);
  }, budgetMs);

  it("requires pin callees to resolve to supported test imports", async () => {
    const results = await lint({
      fixture1: { path: "fixture1.test.ts", code: `fixture.setSystemTime(FIXED); Date.now();` },
      fixture2: { path: "fixture2.test.ts", code: `
      const useFakeTimers = (options) => options;
      useFakeTimers({ now: FIXED });
      Date.now();
    ` },
      fixture3: { path: "fixture3.test.ts", code: `
      function setSystemTime() {}
      setSystemTime(FIXED);
      Date.now();
    ` },
      fixture4: { path: "fixture4.test.ts", code: `
      const jest = { useFakeTimers: (options) => options };
      jest.useFakeTimers({ now: FIXED });
      Date.now();
    ` },
      fixture5: { path: "fixture5.test.ts", code: `
      import { setSystemTime } from "./clock-helper";
      setSystemTime(FIXED);
      Date.now();
    ` },
      fixture6: { path: "fixture6.test.ts", code: `setSystemTime(FIXED); Date.now();` },
      fixture7: { path: "fixture7.test.ts", code: `
      import { setSystemTime as pin } from "bun:test";
      pin(FIXED);
      Date.now();
    ` },
      fixture8: { path: "fixture8.test.ts", code: `
      import { vi } from "vitest";
      vi.setSystemTime(FIXED);
      Date.now();
    ` },
    });
    expect(results.fixture1).toHaveLength(1);
    expect(results.fixture2).toHaveLength(1);
    expect(results.fixture3).toHaveLength(1);
    expect(results.fixture4).toHaveLength(1);
    expect(results.fixture5).toHaveLength(1);
    expect(results.fixture6).toHaveLength(1);
    expect(results.fixture7).toHaveLength(0);
    expect(results.fixture8).toHaveLength(0);
  }, budgetMs);

  it("verifies Playwright clock receivers before exempting page reads", async () => {
    const results = await lint({
      fixture1: `await fixture.clock.setSystemTime(FIXED); await page.evaluate(() => Date.now());`,
      fixture2: `await clock.setSystemTime(FIXED); await page.evaluate(() => Date.now());`,
      fixture3: `await page.clock.install({ time: FIXED }); await page.evaluate(() => Date.now());`,
      fixture4: `await context.clock.setSystemTime(FIXED); await page.evaluate(() => new Date());`,
    });
    expect(results.fixture1)
      .toHaveLength(1);
    expect(results.fixture2)
      .toHaveLength(1);
    expect(results.fixture3)
      .toHaveLength(0);
    expect(results.fixture4)
      .toHaveLength(0);
  }, budgetMs);

  it("honors locally bound clock qualifiers", async () => {
    const results = await lint({
      fixture1: { path: "fixture1.test.ts", code: `
      const window = fakeGlobals;
      const globalThis = fakeGlobals;
      const self = fakeGlobals;
      window.Date.now(); window.performance.now(); window.Date(); new window.Date;
      globalThis.Date.now(); self.performance.now();
    ` },
      fixture2: { path: "fixture2.test.ts", code: `
      function run(self) { return self.Date.now(); }
      self.Date.now();
    ` },
    });
    expect(results.fixture1).toHaveLength(0);
    expect(results.fixture2).toHaveLength(1);
  }, budgetMs);

  it("treats unpinning arguments as no pin", async () => {
    const results = await lint({
      fixture1: { path: "fixture1.test.ts", code: `import { setSystemTime } from "bun:test"; setSystemTime(undefined); Date.now();` },
      fixture2: { path: "fixture2.test.ts", code: `import { setSystemTime } from "bun:test"; setSystemTime(void 0); Date.now();` },
      fixture3: { path: "fixture3.test.ts", code: `import { jest } from "bun:test"; jest.useFakeTimers({ now: undefined }); Date.now();` },
      fixture4: `await page.clock.setSystemTime(undefined); await page.evaluate(() => Date.now());`,
      fixture5: `await page.clock.install({ time: undefined }); await page.evaluate(() => Date.now());`,
      fixture6: { path: "fixture6.test.ts", code: `
      import { jest as testClock } from "bun:test";
      testClock.useFakeTimers({ now: FIXED });
      Date.now();
    ` },
    });
    expect(results.fixture1)
      .toHaveLength(1);
    expect(results.fixture2)
      .toHaveLength(1);
    expect(results.fixture3)
      .toHaveLength(1);
    expect(results.fixture4)
      .toHaveLength(1);
    expect(results.fixture5)
      .toHaveLength(1);
    expect(results.fixture6).toHaveLength(0);
  }, budgetMs);

  it("allows direct and const-start performance measurements only", async () => {
    const results = await lint({
      fixture1: { path: "fixture1.test.ts", code: `
      const started = performance.now();
      const elapsed = performance.now() - started;
      const reversed = started - performance.now();
      const direct = performance.now() - otherStart;
      const unrelated = performance.now();
    ` },
      fixture2: { path: "fixture2.test.ts", code: `
      let started = performance.now();
      const elapsed = performance.now() - started;
    ` },
      fixture3: { path: "fixture3.test.ts", code: `
      const started = performance.now();
      function measure(started) { return performance.now() - started; }
    ` },
    });
    expect(results.fixture1).toHaveLength(1);
    expect(results.fixture2).toHaveLength(1);
    expect(results.fixture3).toHaveLength(1);
  }, budgetMs);

  it("accepts elapsed performance measurements through object and destructured aliases", async () => {
    const results = await lint({
      fixture1: { path: "fixture1.test.ts", code: `
      const timer = performance;
      const started = timer.now();
      const elapsed = timer.now() - started;
      const { now } = performance;
      const elapsedDirect = now() - otherStart;
    ` },
    });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);

  it("honors a reasoned oxlint-disable-next-line directive", async () => {
    const results = await lint({
      fixture1: { path: "fixture1.test.ts", code: `
      // oxlint-disable-next-line home/no-real-waits -- measuring external scheduling
      performance.now();
    ` },
    });
    expect(results.fixture1).toHaveLength(0);
  }, budgetMs);
});
