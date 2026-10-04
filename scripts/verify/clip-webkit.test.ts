import { expect, test } from "bun:test";
import { devices, webkit } from "../../apps/web/node_modules/@playwright/test";
import { defaultWebkitDevice, driveWebkit, validateWebkitCommand, webkitDevice, webkitTarget, webkitVideoSize } from "../../apps/web/scripts/clip-webkit";
import { fixtureRoutes } from "../../apps/web/tests/browser/feature-map/fixtures";
import { measureCalibration, parseClipArgs, previewLabel, webkitGeometry } from "./clip-core.mjs";
import type { ClipState } from "./clip-runtime";
import type { Page } from "../../apps/web/node_modules/@playwright/test";

test("WebKit start options parse and reject unsupported target combinations", () => {
  const args = ["start", "--target", "webkit", "--session", "phone"];
  expect(parseClipArgs(args).target).toBe("webkit");
  expect(parseClipArgs([...args, "--device", "iPhone 15", "--fixture", "send", "--url", "http://localhost:3199/home"]).fixture).toBe("send");
  for (const fixture of ["savings-deposit", "savings-withdraw"]) expect(parseClipArgs([...args, "--fixture", fixture]).fixture).toBe(fixture);
  for (const extra of [["--remote"], ["--keep-status-bar"], ["--viewport", "390x844"], ["--serial", "phone"], ["--fixture", "other"]]) expect(() => parseClipArgs([...args, ...extra])).toThrow();
  expect(() => parseClipArgs(["start", "--target", "chromium", "--session", "phone", "--fixture", "send"])).toThrow("only by webkit");
});

test("default is the newest pinned portrait base iPhone, and device names are validated", () => {
  const newest = Object.keys(devices).filter((name) => /^iPhone \d+$/.test(name)).sort((a, b) => Number(b.split(" ")[1]) - Number(a.split(" ")[1]))[0];
  expect(defaultWebkitDevice).toBe(newest!);
  expect(webkitDevice().profile.viewport).toEqual({ width: 393, height: 659 });
  expect(webkitDevice("iPhone 15 Pro").profile).toBe(devices["iPhone 15 Pro"]!);
  expect(() => webkitDevice("not a device")).toThrow("Choices include: iPhone 15");
});

test("video dimensions explicitly preserve DPR and proportions, with a 2160px longest-edge cap", () => {
  expect(webkitVideoSize({ width: 393, height: 659 }, 3)).toEqual({ width: 1178, height: 1976 });
  expect(webkitVideoSize({ width: 659, height: 393 }, 3)).toEqual({ width: 1976, height: 1178 });
  const large = webkitVideoSize({ width: 1440, height: 900 }, 3);
  expect(large).toEqual({ width: 2160, height: 1350 });
  expect(() => webkitVideoSize({ width: 0, height: 659 }, 3)).toThrow("geometry");
  expect(previewLabel({ target: "webkit", device: "iPhone 15", webkitVersion: "26.0", css: { width: 393, height: 659 } })).toBe("WebKit 26.0 (Playwright iPhone 15 profile) 393×659 CSS px");
});

test("WebKit calibration removes CSS-sized padding, preserves proportions and trims the marker", () => {
  const raw = { width: 1178, height: 1976 }, viewport = { width: 393, height: 659 };
  expect(webkitGeometry(raw, viewport, 393, raw).filter).toBe("crop=393:659:0:0:exact=1,scale=1178:1976,setsar=1");
  expect(webkitGeometry({ width: 800, height: 600 }, { width: 1600, height: 1200 }, 800).filter).toBe("crop=800:600:0:0:exact=1,scale=800:600,setsar=1");
  for (const marker of [0, 200, 1179]) expect(() => webkitGeometry(raw, viewport, marker)).toThrow();
  expect(() => webkitGeometry(raw, viewport, 393, { width: 800, height: 800 })).toThrow("calibration");
  const pixels = new Uint8Array(raw.width * 16 * 3 * 5);
  for (const frame of [0, 1, 2]) for (let x = 0; x < 393; x++) pixels.set([17, 233, 71], frame * raw.width * 16 * 3 + (8 * raw.width + x) * 3);
  expect(measureCalibration(pixels, raw.width)).toEqual({ markerWidth: 393, trim: 4 / 30 });
});

function fakePage() {
  const calls: unknown[][] = [];
  const locator = (selector: string) => Object.fromEntries(["click", "fill", "pressSequentially", "hover", "waitFor", "ariaSnapshot"].map((method) => [method, async (...args: unknown[]) => { calls.push([method, selector, ...args]); return method === "ariaSnapshot" ? "- button Send" : undefined; }]));
  const page = {
    locator, goto: async (...args: unknown[]) => { calls.push(["goto", ...args]); },
    url: () => "https://example.org/", title: async () => "Example",
    keyboard: { press: async (key: string) => { calls.push(["press", key]); } },
    mouse: { wheel: async (x: number, y: number) => { calls.push(["wheel", x, y]); } },
    evaluate: async (...args: unknown[]) => { calls.push(["evaluate", ...args]); return typeof args[0] === "string" ? 42 : { width: 393, height: 659, outerWidth: 393, dpr: 3 }; },
    waitForFunction: async (js: string) => { calls.push(["waitForFunction", js]); },
    waitForTimeout: async (ms: number) => { calls.push(["waitForTimeout", ms]); },
    screenshot: async (options: unknown) => { calls.push(["screenshot", options]); },
    isClosed: () => false,
    setContent: async (html: string) => { calls.push(["setContent", html]); },
    video: () => ({ saveAs: async (path: string) => { calls.push(["video.saveAs", path]); } }),
  };
  return { page: page as unknown as Page, calls };
}

test("command subset translates agent-browser-shaped calls without recreating the page", async () => {
  const { page, calls } = fakePage();
  for (const args of [["open", "http://localhost:3199/home"], ["goto", "https://example.org/"], ["click", 'role=button[name="Send"]'], ["fill", "input", "hello world"], ["type", "input", "more"], ["press", "Enter"], ["hover", "text=Send"], ["scroll", "down"], ["scroll", "up", "200"], ["swipe", "down", "300"], ["wait", "0"], ["wait", "text=Ready"], ["wait", "--fn", "true"], ["screenshot", "/tmp/test.png"]]) await driveWebkit(page, args);
  expect(calls[0]).toEqual(["goto", "http://localhost:3199/home", { waitUntil: "domcontentloaded" }]);
  expect(calls).toContainEqual(["click", 'role=button[name="Send"]']);
  expect(calls).toContainEqual(["fill", "input", "hello world"]);
  expect(calls).toContainEqual(["pressSequentially", "input", "more"]);
  expect(calls).toContainEqual(["wheel", 0, 500]);
  expect(calls).toContainEqual(["wheel", 0, -200]);
  expect(calls).toContainEqual(["waitForTimeout", 0]);
  expect(calls).toContainEqual(["waitFor", "text=Ready", { state: "visible" }]);
  expect(calls).toContainEqual(["waitForFunction", "true"]);
  expect(calls.some((call) => call[0] === "evaluate" && JSON.stringify(call[2]) === '{"direction":"down","distance":300}')).toBe(true);
  expect(await driveWebkit(page, ["eval", "6 * 7"])).toBe(42);
  expect(await driveWebkit(page, ["snapshot"])).toBe("- button Send");
  expect(await driveWebkit(page, ["get", "url"])).toBe("https://example.org/");
  expect(await driveWebkit(page, ["get", "title"])).toBe("Example");
});

test("unsupported commands, refs, flags and malformed arguments fail with the supported subset", () => {
  for (const args of [[], ["record", "stop"], ["close"], ["set", "viewport", "390", "844"], ["click", "@e1"], ["wait", "@e2"], ["snapshot", "-i"], ["get", "text", "body"], ["wait", "--fn"], ["wait", "--text"], ["fill", "input"], ["scroll", "left"], ["swipe", "down", "NaN"], ["click", "button", "--force"], ["tab", "new"]]) expect(() => validateWebkitCommand(args)).toThrow("Supported:");
});

function targetFixture(fixture: ClipState["fixture"] = "send", failClose = false) {
  const state: ClipState = { session: "webkit-test", target: "webkit", fixture, viewport: { width: 390, height: 844 }, raw: "/tmp/raw.webm", createdAt: 1000, maxAge: 600, workerNonce: "test" };
  const { page, calls } = fakePage();
  const routes: unknown[][] = [];
  const context = {
    setDefaultTimeout() {}, setDefaultNavigationTimeout() {},
    addInitScript: async (script: string) => { calls.push(["init", script]); },
    route: async (pattern: string, handler: (route: unknown) => Promise<unknown>) => { await handler({ fulfill: async (body: unknown) => { routes.push([pattern, body]); } }); },
    newPage: async () => { calls.push(["newPage"]); return page; },
    close: async () => { calls.push(["context.close"]); if (failClose) throw new Error("flush failed"); },
  };
  const browser = { version: () => "26.0", isConnected: () => true, newContext: async (options: unknown) => { calls.push(["newContext", options]); return context; }, close: async () => { calls.push(["browser.close"]); } };
  const target = webkitTarget(state, "/private-state", { webkit: { launch: async () => { calls.push(["launch"]); return browser; } } as unknown as typeof webkit, save: async () => { calls.push(["save"]); } });
  return { target, state, calls, routes };
}

test("fixtures use the shared route source, seed before navigation, and reuse one context/page", async () => {
  for (const kind of ["send", "savings-deposit", "savings-withdraw"] as const) {
    const { target, state, calls, routes } = targetFixture(kind);
    await target.start();
    expect(routes).toEqual(fixtureRoutes({ prepare: kind }).map(([pattern, body]) => [pattern, { status: 200, contentType: "application/json", body: JSON.stringify(body) }]));
    expect(calls.find((call) => call[0] === "init")?.[1]).toBe('sessionStorage.setItem("home:playwright-smoke:signed-in","1");localStorage.setItem("home.country.v2","US");');
    expect(calls.findIndex((call) => call[0] === "init")).toBeLessThan(calls.findIndex((call) => call[0] === "goto"));
    expect(calls).toContainEqual(["waitFor", "[data-app-main-authenticated]", { state: "visible", timeout: 90000 }]);
    await target.command!(["click", "text=Send"]);
    await target.command!(["snapshot"]);
    expect(calls.filter((call) => call[0] === "newPage")).toHaveLength(1);
    expect(state.device).toBe("iPhone 15");
    expect(state.css?.width).toBe(393);
    expect((calls.find((call) => call[0] === "newContext")?.[1] as { recordVideo: unknown }).recordVideo).toEqual({ dir: "/private-state", size: { width: 1178, height: 1976 } });
    await target.cleanup();
  }
});

test("a URL-less start initializes a responsive blank page at the device viewport", async () => {
  const { target, state, calls } = targetFixture();
  state.fixture = undefined;
  await target.start();
  expect(calls).toContainEqual(["setContent", '<meta name="viewport" content="width=device-width, initial-scale=1">']);
  expect(calls.some((call) => call[0] === "goto")).toBe(false);
  await target.cleanup();
});

test("stop flushes the context before saving video, then cleanup closes the browser only once", async () => {
  const { target, calls } = targetFixture();
  await target.start();
  await target.stop();
  await target.cleanup();
  expect(calls.slice(-3)).toEqual([["context.close"], ["video.saveAs", "/tmp/raw.webm"], ["browser.close"]]);
});

test("cleanup closes the browser after a context flush failure or a partial start", async () => {
  const { target, calls } = targetFixture("send", true);
  await target.start();
  await expect(target.cleanup()).rejects.toThrow("flush failed");
  expect(calls.slice(-2)).toEqual([["context.close"], ["browser.close"]]);
  const unsafe = targetFixture(); unsafe.state.url = "https://example.org/home";
  await expect(unsafe.target.start()).rejects.toThrow("loopback HTTP");
  await unsafe.target.cleanup();
  expect(unsafe.calls).toEqual([]);
});
