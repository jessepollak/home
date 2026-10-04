import { test, expect } from "bun:test";
import { androidGeometry, androidStatusBar, normalizationArgs, parseClipArgs, previewLabel } from "./clip-core.mjs";

const display = (width = 1080, height = 2400, bar = 118) => `
  Display: mDisplayId=0 (organized)
    InsetsState
      mDisplayFrame=Rect(0, 0 - ${width}, ${height})
        InsetsSource id=10000 type=statusBars frame=[0,0][${width},${bar}] visible=true flags= sideHint=TOP
    InsetsSourceProviders:
      mSource=InsetsSource id=10000 type=statusBars frame=[0,0][${width},${bar}] visible=true
`;

test("Android status bar opt-out is a start-only boolean restricted to Android", () => {
  const start = ["start", "--target", "android", "--session", "crop"];
  expect(parseClipArgs(start).keepStatusBar).toBeUndefined();
  expect(parseClipArgs([...start, "--keep-status-bar", "--remote"]).keepStatusBar).toBe(true);
  for (const args of [
    [...start, "--keep-status-bar", "--keep-status-bar"],
    [...start, "--keep-status-bar", "false"],
    ["start", "--target", "chromium", "--session", "crop", "--keep-status-bar"],
    ["start", "--target", "ios", "--session", "crop", "--keep-status-bar"],
    ["stop", "--session", "crop", "--out", "crop.mp4", "--keep-status-bar"],
    ["cleanup", "--session", "crop", "--keep-status-bar"],
  ]) expect(() => parseClipArgs(args)).toThrow();
});

test("Android uses the default display's actual status bar inset rather than cutouts or gestures", () => {
  const extra = "\n        InsetsSource id=10005 type=mandatorySystemGestures frame=[0,0][1080,150] visible=true\n";
  expect(androidStatusBar(display() + extra)).toEqual({ width: 1080, height: 2400, statusBarHeight: 118 });
  expect(androidStatusBar(display(1080, 1920, 63))).toEqual({ width: 1080, height: 1920, statusBarHeight: 63 });
  expect(androidStatusBar(display() + display(800, 600, 24).replace("mDisplayId=0", "mDisplayId=2"))).toEqual({ width: 1080, height: 2400, statusBarHeight: 118 });
});

test("missing, malformed, conflicting or non-top Android insets fail with an explicit escape hatch", () => {
  for (const dump of [
    "", display().replace("mDisplayId=0", "mDisplayId=1"),
    display().replaceAll("statusBars", "displayCutout"),
    display().replace("mDisplayFrame=Rect(0, 0 - 1080, 2400)", "mDisplayFrame=Rect(0, 0 - 0, 0)"),
    display(1080, 2400, 0), display(1080, 2400, 2400),
    display().replaceAll("frame=[0,0]", "frame=[0,20]"),
    display().replaceAll("frame=[0,0][1080,118]", "frame=[0,0][500,118]"),
    display().replace("[1080,118]", "[1080,120]"),
  ]) expect(() => androidStatusBar(dump)).toThrow("--keep-status-bar");
});

test("Android crop removes all status bar pixels without scaling Chrome and uses even dimensions and square pixels", () => {
  const raw = { width: 1080, height: 2400 };
  expect(androidGeometry(raw, raw, 118)).toEqual({ width: 1080, height: 2282, top: 118, filter: "crop=1080:2282:0:118,setsar=1" });
  expect(androidGeometry({ width: 1081, height: 2401 }, { width: 1081, height: 2401 }, 119)).toEqual({ width: 1080, height: 2280, top: 120, filter: "crop=1080:2280:0:120,setsar=1" });
  const filter = androidGeometry(raw, raw, 118).filter;
  expect(normalizationArgs("raw.mp4", "out.mp4", filter)).toContain("crop=1080:2282:0:118,setsar=1");
});

test("Android crop refuses absent or mismatched geometry rather than emitting an uncropped video", () => {
  const raw = { width: 1080, height: 2400 };
  for (const [screen, bar] of [[undefined, 118], [raw, undefined], [raw, 0], [raw, -1], [raw, 1.5], [raw, 1200], [raw, NaN], [{ width: 2400, height: 1080 }, 118], [{ width: 720, height: 1600 }, 118]] as const) {
    expect(() => androidGeometry(raw, screen, bar)).toThrow("--keep-status-bar");
  }
});

test("Android Preview label distinguishes cropped clips from explicit status bar retention", () => {
  const state = { target: "android", model: "Pixel 7a", chromeVersion: "123", css: { width: 411, height: 789 }, statusBarHeight: 118 };
  expect(previewLabel(state)).toBe("Android Chrome 123 (Pixel 7a) 411×789 CSS px — status bar cropped");
  expect(previewLabel({ ...state, keepStatusBar: true })).toBe("Android Chrome 123 (Pixel 7a) 411×789 CSS px — status bar retained");
});
