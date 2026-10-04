import assert from "node:assert/strict";
import test from "node:test";
import { activateRecordedPage, assertBrowserArgs, assertFixtureNavigation, assertFixtureTargets, assertSessionAge, chromiumGeometry, measureCalibration, cleanupSteps, dndMode, loopbackPort, normalizationArgs, parseClipArgs, parseViewport, previewLabel, selectAndroidDevice, shellQuote, targetFlags, validateChromiumViewport } from "../../verify/clip-core.mjs";

test("clip parses the three commands and target-specific options", () => {
  assert.deepEqual(parseClipArgs(["start", "--target", "chromium", "--session", "pr-1", "--remote", "--viewport", "1440x900"]), { command: "start", target: "chromium", session: "pr-1", remote: true, viewport: { width: 1440, height: 900 }, maxAge: 600, browserArgs: [] });
  assert.equal(parseClipArgs(["start", "--target", "android", "--session", "pr", "--serial", "device-1"]).serial, "device-1");
  assert.deepEqual(parseClipArgs(["start", "--target", "ios", "--session", "pr", "--device", "iPhone"] ).viewport, { width: 390, height: 844 });
  assert.deepEqual(parseClipArgs(["ab", "--session", "pr", "--", "eval", "a -- b"]).browserArgs, ["eval", "a -- b"]);
  assert.equal(parseClipArgs(["stop", "--session", "pr", "--out", "./motion.mp4"]).out, "./motion.mp4");
  assert.equal(parseClipArgs(["cleanup", "--session", "pr"]).command, "cleanup");
});

test("clip rejects unknown, missing, conflicting and unsafe arguments", () => {
  for (const args of [[], ["start", "--session", "pr"], ["start", "--target", "other", "--session", "pr"], ["stop", "--session", "../pr", "--out", "a.mp4"], ["stop", "--session", "pr", "--out", "a.webm"], ["ab", "--session", "pr"], ["start", "--target", "android", "--session", "pr", "--viewport", "390x844"], ["start", "--target", "chromium", "--session", "pr", "--viewport", "0x844"], ["start", "--target", "chromium", "--session", "pr", "--url", "https://user:password@example.com"], ["start", "--target", "android", "--session", "pr", "--serial", "a", "--device", "b"], ["stop", "--session", "pr", "--session", "other"], ["stop", "--session", "pr", "--wat"]]) assert.throws(() => parseClipArgs(args));
});

test("browser flags are pinned to each session target", () => {
  assert.deepEqual(targetFlags({ session: "pr", target: "chromium" }), ["--session", "pr"]);
  assert.deepEqual(targetFlags({ session: "pr", target: "ios", device: "iPhone" }), ["--session", "pr", "-p", "ios", "--device", "iPhone"]);
  assert.deepEqual(targetFlags({ session: "pr", target: "android", cdpPort: 9222 }), ["--session", "pr", "--cdp", "9222", "--pin-tab"]);
  assert.throws(() => targetFlags({ session: "pr", target: "android" }));
  for (const args of [["--session=other", "snapshot"], ["-p", "ios", "snapshot"], ["--cdp", "123", "snapshot"], ["record", "stop"], ["close"], ["set", "viewport", "100", "100"]]) assert.throws(() => assertBrowserArgs(args));
  assert.doesNotThrow(() => assertBrowserArgs(["eval", "'--session' is text"]));
});

test("Chromium restores measured capture width before cropping narrow frames", () => {
  const raw = { width: 780, height: 1688 }, viewport = { width: 390, height: 844, outerWidth: 500, dpr: 2 };
  assert.deepEqual(chromiumGeometry(raw, viewport, 608.4), { width: 780, height: 1688, restoredWidth: 1000, filter: "scale=1000:1688,crop=780:1688:0:0,setsar=1" });
  assert.equal(chromiumGeometry(raw, { ...viewport, outerWidth: 578 }, 526.3).restoredWidth, 1156);
  for (const markerWidth of [778, 779, 780]) assert.equal(chromiumGeometry(raw, viewport, markerWidth).filter, null);
  assert.equal(chromiumGeometry({ width: 2880, height: 1800 }, { width: 1440, height: 900, dpr: 2 }, 2880).filter, null);
  assert.throws(() => chromiumGeometry(raw, viewport, 0), /marker not found/);
  assert.throws(() => chromiumGeometry({ width: 640, height: 480 }, viewport, 640), /refusing to guess/);
  assert.throws(() => validateChromiumViewport({ ...viewport, dpr: 1 }), /DPR2/);
  const args = normalizationArgs("raw.webm", "out.mp4", null);
  for (const value of ["libx264", "yuv420p", "30", "+faststart", "scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1"]) assert.ok(args.includes(value));
});

test("calibration measures actual pixels, requires three frames and trims all marker frames", () => {
  const width = 100, rows = 16, pixels = new Uint8Array(width * rows * 3 * 6);
  for (const frame of [1, 2, 3]) for (let x = 0; x < 78; x++) pixels.set([17, 233, 71], frame * width * rows * 3 + (8 * width + x) * 3);
  assert.deepEqual(measureCalibration(pixels, width), { markerWidth: 78, trim: 5 / 30 });
  assert.throws(() => measureCalibration(pixels.subarray(0, width * rows * 3 * 3), width), /at least three/);
  assert.throws(() => measureCalibration(new Uint8Array(pixels.length), width), /marker not found/);
  assert.ok(normalizationArgs("raw", "out", null, 0.5).includes("trim=start=0.5,setpts=PTS-STARTPTS,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1"));
});

test("cleanup is sequential, continues after failures and reports them", async () => {
  const called = [];
  const names = ["recorder", "browser", "forward", "reverse", "DND", "device lock", "tunnel", "session"];
  await assert.rejects(cleanupSteps(names.map((name) => [name, async () => { called.push(name); if (name === "recorder" || name === "reverse") throw new Error(name); }])), /recorder:[\s\S]*reverse:/);
  assert.deepEqual(called, names);
});

test("device selection prefers the sole physical phone, supports serial and reports ambiguity", () => {
  const physical = { serial: "phone-1", model: "Pixel 7a", avd: "" };
  const emulator = { serial: "emulator-5554", model: "Pixel 8", avd: "test-avd" };
  assert.equal(selectAndroidDevice([emulator, physical], {}), physical);
  assert.equal(selectAndroidDevice([emulator, physical], { serial: emulator.serial }), emulator);
  assert.equal(selectAndroidDevice([emulator, physical], { device: "test-avd" }), emulator);
  assert.equal(selectAndroidDevice([emulator], {}), emulator);
  assert.throws(() => selectAndroidDevice([physical, { ...physical, serial: "phone-2" }], {}), /phone-1.*phone-2/);
  assert.throws(() => selectAndroidDevice([], {}), /none/);
  assert.deepEqual(["0", "1", "2", "3"].map(dndMode), ["all", "priority", "none", "alarms"]);
  assert.throws(() => dndMode("null"), /refusing/);
});

test("labels and reverse-tunnel ports are derived from measured state", () => {
  const css = { width: 412, height: 811 };
  assert.equal(previewLabel({ target: "chromium", css }), "Chromium 412×811 CSS px");
  assert.equal(previewLabel({ target: "android", model: "Pixel 7a", chromeVersion: "123", css }), "Android Chrome 123 (Pixel 7a) 412×811 CSS px");
  assert.equal(previewLabel({ target: "android", model: "Pixel 8", chromeVersion: "123", emulator: true, css }), "Android Chrome 123 (Pixel 8 emulator) 412×811 CSS px");
  assert.equal(loopbackPort("http://127.0.0.1:3199/home"), 3199);
  assert.equal(loopbackPort("http://localhost/home"), 80);
  assert.equal(loopbackPort("https://example.com/home"), null);
  assert.equal(loopbackPort(undefined), null);
  assert.equal(shellQuote("a'b"), "'a'\\''b'");
});

test("Android activates the exact driven tab and detaches every temporary CDP session", async () => {
  const calls = [];
  const cdp = { async command(method, params, session) {
    calls.push([method, params, session]);
    if (method === "Target.getTargets") return { targetInfos: [{ type: "page", targetId: "unrelated" }, { type: "page", targetId: "clip" }] };
    if (method === "Target.attachToTarget") return { sessionId: params.targetId };
    if (method === "Runtime.evaluate") return { result: { value: session === "clip" } };
    return {};
  } };
  assert.equal(await activateRecordedPage(cdp, "unique-marker", async (_cdp, target, session) => { calls.push(["activate", target, session]); }, ["unrelated"]), "clip");
  assert.deepEqual(calls.filter(([method]) => method === "activate"), [["activate", "clip", "clip"]]);
  assert.deepEqual(calls.filter(([method]) => method === "Target.attachToTarget").map(([, params]) => params.targetId), ["clip"]);
  assert.deepEqual(calls.filter(([method]) => method === "Target.detachFromTarget").map(([, params]) => params.sessionId), ["clip"]);
  await assert.rejects(activateRecordedPage({ async command(method) {
    if (method === "Target.getTargets") return { targetInfos: [] };
  } }, "missing", async () => {}), /refusing to record/);
});

test("physical origin enforcement grandfathers only pre-existing background targets", () => {
  const state = { target: "android", url: "http://127.0.0.1:3199/home" };
  for (const args of [["open", "https://example.com"], ["goto", "https://example.com"], ["navigate", "example.com"], ["open", "example.com"], ["open", "/other"], ["open", "127.0.0.1:3199/other"], ["open"], ["tab", "new", state.url], ["tab", "t1"], ["tab", "list", "--activate"], ["tab", "close"], ["connect", "9222"], ["batch", "[]"], ["--no-pin-tab", "snapshot"]]) assert.throws(() => { assertBrowserArgs(args); assertFixtureNavigation(state, args); });
  for (const command of ["open", "goto", "navigate"]) assert.doesNotThrow(() => assertFixtureNavigation(state, [command, "http://127.0.0.1:3199/other"]));
  assert.doesNotThrow(() => assertFixtureNavigation({ ...state, url: "https://example.com/home" }, ["goto", "example.com/other"]));
  assert.doesNotThrow(() => assertFixtureNavigation({ ...state, emulator: true }, ["open", "https://example.com"]));
  const own = { type: "page", targetId: "own", url: state.url }, old = { type: "page", targetId: "old", url: "https://example.com" };
  for (const targets of [[], null, [{ ...own, url: "about:blank" }], [own, { ...old, targetId: "new" }]]) assert.throws(() => assertFixtureTargets(targets, state.url, ["old"], "own"));
  assert.doesNotThrow(() => assertFixtureTargets([own, old], state.url, ["old"], "own"));
  assert.throws(() => assertFixtureTargets([own, old], state.url, ["old"], "own", "old"));
});

test("session expiry applies to every target and Android leaves cleanup margin", () => {
  for (const target of ["chromium", "android", "ios"]) {
    const state = { target, createdAt: 1000, maxAge: 600 };
    assert.doesNotThrow(() => assertSessionAge(state, 600999));
    assert.throws(() => assertSessionAge(state, 601000), /expired/);
  }
  assert.throws(() => assertSessionAge({ target: "android", createdAt: 1, maxAge: 600, recordingAt: 1000 }, 171000), /3-minute/);
  assert.equal(parseClipArgs(["start", "--target", "chromium", "--session", "a", "--max-age", "12"]).maxAge, 12);
  for (const age of ["0", "-1", "1.5", "Infinity"]) assert.throws(() => parseClipArgs(["start", "--target", "chromium", "--session", "a", "--max-age", age]));
});

test("viewport rejects narrow capture geometry before recording", () => {
  for (const width of [100, 166]) assert.throws(() => parseViewport(`${width}x844`));
  assert.deepEqual(parseViewport("167x844"), { width: 167, height: 844 });
});
