import { afterAll, describe, expect, it } from "bun:test";
import { cp, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const appsWebDir = fileURLToPath(new URL("../..", import.meta.url));
const mirror = await mkdtemp(path.join(tmpdir(), "home-oxlint-no-deferred-effect-setstate-"));
await cp(path.join(appsWebDir, "oxlint"), path.join(mirror, "oxlint"), { recursive: true });
await symlink(path.join(appsWebDir, "node_modules"), path.join(mirror, "node_modules"), "dir");
afterAll(() => rm(mirror, { recursive: true, force: true }));

let fixtureIndex = 0;
async function lint(code) {
  fixtureIndex += 1;
  const fixture = `fixture-${fixtureIndex}.tsx`;
  const config = `.oxlintrc-${fixtureIndex}.json`;
  await writeFile(path.join(mirror, fixture), code);
  await writeFile(path.join(mirror, config), JSON.stringify({
    plugins: [],
    categories: { correctness: "off" },
    env: { browser: true, node: true, es2024: true },
    jsPlugins: ["./oxlint/home-plugin.mjs"],
    rules: { "home/no-deferred-effect-setstate": "error" },
  }));
  const result = spawnSync(
    path.join(appsWebDir, "node_modules", ".bin", "oxlint"),
    ["-c", config, "--disable-nested-config", "-f", "json", fixture],
    { cwd: mirror, encoding: "utf8" },
  );
  expect(result.signal).toBeNull();
  expect([0, 1]).toContain(result.status);
  return JSON.parse(result.stdout).diagnostics.filter((diagnostic) =>
    diagnostic.code === "home(no-deferred-effect-setstate)");
}

describe("no-deferred-effect-setstate", () => {
  it("rejects queueMicrotask setter callbacks in all effect forms and nested subscriptions using the set[A-Z] heuristic", async () => {
    expect(await lint(`
      const setReady = () => {}, setTotal = () => {}, setWidth = () => {}, setTheme = () => {};
      useEffect(() => { queueMicrotask(() => setReady(true)); });
      React.useEffect(() => { if (active) queueMicrotask(() => setTotal(1)); });
      useLayoutEffect(() => {
        subscribe(() => { queueMicrotask(() => setWidth(100)); });
      });
      React.useInsertionEffect(() => queueMicrotask(function () { setTheme('dark'); }));
    `)).toHaveLength(4);
  });

  it("rejects Promise.resolve(...).then setter callbacks with or without a resolve argument", async () => {
    expect(await lint(`
      const setLoaded = () => {}, setData = () => {};
      useEffect(() => { Promise.resolve().then(() => setLoaded(true)); });
      React.useLayoutEffect(() => Promise.resolve(value).then(() => setData(value)));
    `)).toHaveLength(2);
  });

  it("rejects same-scope queueMicrotask aliases and parent-scope aliases", async () => {
    expect(await lint(`
      const setStatus = () => {};
      const defer = queueMicrotask;
      function Screen() {
        useEffect(() => {
          const later = defer;
          later(() => setStatus('ready'));
        });
      }
    `)).toHaveLength(1);
  });

  it("rejects same-scope Promise.resolve promise aliases", async () => {
    expect(await lint(`
      const setReady = () => {};
      useEffect(() => {
        const ready = Promise.resolve();
        ready.then(() => setReady(true));
      });
    `)).toHaveLength(1);
  });

  it("rejects immutable Promise.resolve scheduler aliases", async () => {
    expect(await lint(`
      const schedule = Promise.resolve;
      function Screen({ setReady }) {
        const commit = setReady;
        useEffect(() => { schedule().then(() => commit(true)); }, []);
      }
    `)).toHaveLength(1);
  });

  it("rejects callbacks bound by identifier as const functions or function declarations", async () => {
    expect(await lint(`
      const setCount = () => {};
      useEffect(() => {
        function apply() { setCount(1); }
        const finish = () => setCount(2);
        queueMicrotask(apply);
        Promise.resolve().then(finish);
      });
    `)).toHaveLength(2);
  });

  it("resolves function declarations in enclosing scopes and reports an actionable recovery", async () => {
    const diagnostics = await lint(`
      const setReady = () => {};
      function Screen() {
        function apply() { setReady(true); }
        useEffect(() => { queueMicrotask(apply); });
      }
    `);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("useSyncExternalStore clock");
    expect(diagnostics[0].message).toContain("useSyncExternalStore(subscribe, () => true, () => false)");
  });

  it("recognizes a useState or useReducer second-element setter without the set[A-Z] prefix", async () => {
    expect(await lint(`
      function Screen() {
        const [value, updateValue] = useState(0);
        const [state, dispatch] = React.useReducer(reducer, 0);
        useEffect(() => {
          queueMicrotask(() => updateValue(1));
          Promise.resolve().then(() => dispatch({ type: 'ready' }));
        });
      }
    `)).toHaveLength(2);
  });

  it("rejects immutable aliases of state tuple setters and locally bound set[A-Z] names", async () => {
    expect(await lint(`
      function Screen({ setReady }) {
        const commit = setReady;
        const [value, updateValue] = useState(0);
        const publish = updateValue;
        useEffect(() => {
          queueMicrotask(() => commit(true));
          queueMicrotask(() => publish(1));
        }, []);
      }
    `)).toHaveLength(2);
  });

  it("rejects directly bound state setters as deferred callbacks", async () => {
    expect(await lint(`
      const setReady = () => {};
      function Screen() {
        const [value, dispatch] = React.useReducer(reducer, 0);
        useEffect(() => {
          queueMicrotask(setReady);
          Promise.resolve().then(dispatch);
        });
      }
    `)).toHaveLength(2);
  });

  it("accepts directly bound non-setter callbacks in deferred callbacks", async () => {
    expect(await lint(`
      function Screen() {
        const measure = () => {};
        useEffect(() => {
          queueMicrotask(measure);
          Promise.resolve(value).then(measure);
        });
      }
    `)).toHaveLength(0);
  });

  it("accepts animation-frame measurement setters and real-deadline timers", async () => {
    expect(await lint(`
      const setWidth = () => {}, setExpired = () => {};
      useLayoutEffect(() => {
        requestAnimationFrame(() => setWidth(element.getBoundingClientRect().width));
        setTimeout(() => setExpired(true), deadline - Date.now());
      });
    `)).toHaveLength(0);
  });

  it("accepts microtasks without setter calls and deferred event-handler transitions", async () => {
    expect(await lint(`
      const setOpen = () => {}, setSaved = () => {};
      useEffect(() => { queueMicrotask(() => input.focus()); });
      function onClick() {
        queueMicrotask(() => setOpen(true));
        Promise.resolve().then(() => setSaved(true));
      }
    `)).toHaveLength(0);
  });

  it("allows global timer functions inside deferred callbacks without a setter", async () => {
    expect(await lint(`
      useEffect(() => { queueMicrotask(() => setTimeout(tick, 5)); }, []);
      useEffect(() => { queueMicrotask(() => setInterval(tick, 5)); }, []);
    `)).toHaveLength(0);
  });

  it("allows timer and global host function aliases inside deferred callbacks", async () => {
    expect(await lint(`
      const setTimer = setTimeout;
      const setRepeater = setInterval;
      const setMicrotask = queueMicrotask;
      const setFrame = requestAnimationFrame;
      useEffect(() => {
        queueMicrotask(() => setTimer(tick, 5));
        queueMicrotask(() => setRepeater(tick, 5));
        queueMicrotask(() => setMicrotask(tick));
        queueMicrotask(() => setFrame(tick));
      }, []);
    `)).toHaveLength(0);
  });

  it("still rejects an alias of a real setter inside deferred callbacks", async () => {
    expect(await lint(`
      function Screen({ setState }) {
        const commit = setState;
        useEffect(() => { queueMicrotask(() => commit(true)); }, []);
      }
    `)).toHaveLength(1);
  });

  it("resolves aliases by lexical binding without treating a shadowed name as the global microtask", async () => {
    expect(await lint(`
      function Screen(queueMicrotask) {
        useEffect(() => queueMicrotask(() => setReady(true)));
      }
    `)).toHaveLength(0);
  });
});
