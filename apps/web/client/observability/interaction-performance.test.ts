import { describe, expect, test } from "bun:test";
import type { HomeNavigationReport, HomeScrollReport } from "@/shared/observability/client-performance.contract";
import {
  classifyHomeDevice,
  classifyHomeEngine,
  createHomeInteractionRecorder, resolveHomeInteractionSampleRate,
} from "./interaction-performance";

const navigation = { from: "/home", to: "/cash", cache: "first-visit", trigger: "in-app" } as const;
const scroll = { route: "/home", cache: "retained" } as const;

function fixture({ sampleRate = 1, supported = true }: { sampleRate?: number; supported?: boolean } = {}) {
  let time = 0;
  let visible = true;
  let draws = 0;
  let observer: ((start: number, duration: number) => void) | null = null;
  const frames = new Map<number, () => void>();
  const timers = new Map<number, () => void>();
  const sent: (HomeNavigationReport | HomeScrollReport)[] = [];
  let next = 0;
  const recorder = createHomeInteractionRecorder({
    now: () => time, random: () => { draws += 1; return 0.5; }, sampleRate,
    device: () => "mobile-low", engine: () => "webkit", isVisible: () => visible,
    requestFrame: (run) => { const id = ++next; frames.set(id, run); return id; },
    cancelFrame: (id) => { frames.delete(id); },
    scheduleTimeout: (run) => { const id = ++next; timers.set(id, run); return id as unknown as ReturnType<typeof setTimeout>; },
    clearTimeout: (handle) => { timers.delete(handle as unknown as number); },
    observeLongFrames: (onEntry) => {
      if (!supported) return null;
      observer = onEntry;
      return () => { observer = null; };
    },
    send: (report) => { sent.push(report); },
  });
  return {
    recorder, sent, frames, timers,
    get draws() { return draws; },
    at(value: number) { time = value; },
    hide() { visible = false; recorder.pageHidden(); },
    show() { visible = true; },
    frame() { const entry = frames.entries().next().value; if (entry) { frames.delete(entry[0]); entry[1](); } },
    idle() { const entry = [...timers.entries()].at(-1); if (entry) { timers.delete(entry[0]); entry[1](); } },
    longFrame(start: number, duration: number) { observer?.(start, duration); },
  };
}

describe("Home interaction recorder", () => {
  test("decides sampling lazily once and never measures unsampled loads", () => {
    const value = fixture({ sampleRate: 0 });
    expect(value.draws).toBe(0);
    value.recorder.beginNavigation(navigation);
    value.recorder.noteScrollIntent();
    value.recorder.noteScroll(scroll);
    expect(value.draws).toBe(1);
    expect(value.frames.size).toBe(0);
    expect(value.sent).toEqual([]);
  });
  test("navigation emits after paint with bucketed timing; duplicate and same route ignored", () => {
    const value = fixture();
    value.recorder.beginNavigation(navigation);
    value.recorder.commitNavigation("/cash");
    value.recorder.commitNavigation("/cash");
    value.at(24); value.frame();
    expect(value.sent).toEqual([]);
    value.at(27); value.idle();
    expect(value.sent).toEqual([{ version: 1, kind: "home-navigation", route: "/cash",
      from: "/home", trigger: "in-app", cache: "first-visit", device: "mobile-low", engine: "webkit", durationMs: 30, cachePersistMs: 0 }]);
    value.recorder.beginNavigation({ ...navigation, from: "/cash" });
    expect(value.frames.size).toBe(0);
    expect(value.draws).toBe(1);
  });
  test("superseded and hidden navigations are dropped", () => {
    const value = fixture();
    value.recorder.beginNavigation(navigation);
    value.recorder.commitNavigation("/cash");
    value.recorder.beginNavigation({ ...navigation, to: "/borrow", trigger: "history" });
    value.frame();
    value.recorder.commitNavigation("/borrow");
    value.frame(); value.hide(); value.idle();
    expect(value.sent).toEqual([]);
  });
  test("separates queued input, navigation paint, and overlapping cache writes", () => {
    const value = fixture();
    value.at(800);
    value.recorder.notePersistence(50, 650);
    value.recorder.notePersistence(10, 20);
    value.recorder.noteInput(100);
    value.at(820);
    value.recorder.beginNavigation({ ...navigation, to: "/investments" });
    value.recorder.noteContent("/cash", "loading");
    value.recorder.noteContent("/investments", "ready");
    value.recorder.commitNavigation("/investments");
    value.at(850); value.frame();
    value.at(860); value.idle();
    expect(value.sent).toEqual([{ version: 1, kind: "home-navigation", route: "/investments",
      from: "/home", trigger: "in-app", cache: "first-visit", device: "mobile-low", engine: "webkit",
      durationMs: 40, dispatchDelayMs: 700, inputToPaintMs: 760, cachePersistMs: 600, contentState: "ready" }]);
  });
  test("normalizes epoch event timestamps and reports a loading destination honestly", () => {
    const value = fixture();
    value.at(500);
    value.recorder.noteInput(1_000_100, 1_000_000);
    value.recorder.beginNavigation(navigation);
    value.recorder.noteContent("/cash", "loading");
    value.recorder.commitNavigation("/cash"); value.frame(); value.idle();
    expect(value.sent[0]).toMatchObject({ dispatchDelayMs: 400, inputToPaintMs: 400, contentState: "loading" });
  });
  test("does not attach an expired click to a later programmatic navigation", () => {
    const value = fixture();
    value.at(100); value.recorder.noteInput(50); value.idle();
    value.recorder.beginNavigation(navigation);
    value.recorder.commitNavigation("/cash"); value.frame(); value.idle();
    expect(value.sent[0]).not.toHaveProperty("dispatchDelayMs");
  });
  test("history navigation does not inherit click timing", () => {
    const value = fixture();
    value.at(100); value.recorder.noteInput(50);
    value.recorder.beginNavigation({ ...navigation, trigger: "history" });
    value.recorder.commitNavigation("/cash"); value.frame(); value.idle();
    expect(value.sent[0]).not.toHaveProperty("inputToPaintMs");
  });
  test("invalid input clocks do not fabricate dispatch delay", () => {
    for (const timestamp of [NaN, Infinity, -1, 0, 101, -100_000]) {
      const value = fixture();
      value.at(100); value.recorder.noteInput(timestamp);
      value.recorder.beginNavigation(navigation);
      value.recorder.commitNavigation("/cash"); value.frame(); value.idle();
      expect(value.sent[0]).not.toHaveProperty("dispatchDelayMs");
    }
  });
  test("unsampled inputs and cache writes schedule no telemetry work", () => {
    const value = fixture({ sampleRate: 0 });
    value.at(100); value.recorder.noteInput(10); value.recorder.notePersistence(10, 80);
    expect(value.timers.size).toBe(0);
    expect(value.frames.size).toBe(0);
    expect(value.sent).toEqual([]);
  });
  test("hidden pages discard previous input and cache attribution", () => {
    const value = fixture();
    value.at(500); value.recorder.noteInput(100); value.recorder.notePersistence(100, 300);
    value.hide(); value.show();
    value.recorder.beginNavigation(navigation);
    value.recorder.commitNavigation("/cash"); value.frame(); value.idle();
    expect(value.sent[0]).toMatchObject({ cachePersistMs: 0 });
    expect(value.sent[0]).not.toHaveProperty("dispatchDelayMs");
  });
  test("hiding during pending navigation cancels both paint and delivery even after resuming", () => {
    for (const afterPaint of [false, true]) {
      const value = fixture();
      value.recorder.beginNavigation(navigation);
      value.recorder.commitNavigation("/cash");
      if (afterPaint) { value.at(20); value.frame(); }
      value.hide();
      expect(value.frames.size).toBe(0);
      expect(value.timers.size).toBe(0);
      value.show(); value.at(5_000); value.frame(); value.idle();
      expect(value.sent).toEqual([]);
    }
  });
  test("ignores navigation starts while hidden", () => {
    const value = fixture();
    value.hide();
    value.recorder.beginNavigation(navigation);
    value.show();
    value.recorder.commitNavigation("/cash"); value.frame(); value.idle();
    expect(value.sent).toEqual([]);
    value.recorder.beginNavigation(navigation);
    value.recorder.commitNavigation("/cash"); value.frame(); value.idle();
    expect(value.sent).toHaveLength(1);
  });
  test("caps navigation reports per page load", () => {
    const value = fixture();
    for (let i = 0; i < 11; i++) {
      value.recorder.beginNavigation(navigation);
      value.recorder.commitNavigation("/cash"); value.frame(); value.idle();
    }
    expect(value.sent).toHaveLength(10);
  });
  test("ignores programmatic scroll without recent intent", () => {
    const value = fixture();
    value.recorder.noteScroll(scroll);
    value.recorder.noteScrollIntent(); value.at(1_001); value.recorder.noteScroll(scroll);
    expect(value.frames.size).toBe(0);
    expect(value.sent).toEqual([]);
  });
  test("scroll emits frame gaps and overlapping long frames after idle", () => {
    const value = fixture();
    value.recorder.noteScrollIntent(); value.recorder.noteScroll(scroll);
    value.at(16); value.frame(); value.longFrame(12, 40);
    value.at(50); value.frame(); value.longFrame(-20, 1);
    value.at(79); value.frame();
    value.recorder.noteScroll(scroll);
    value.at(379); value.idle();
    expect(value.sent).toEqual([{ version: 1, kind: "home-scroll", route: "/home",
      cache: "retained", device: "mobile-low", engine: "webkit", durationMs: 100, frameCount: 3,
      slowFrameCount: 2, maxFrameMs: 30, longFrameCount: 1, longFrameMs: 40 }]);
    expect(value.frames.size).toBe(0);
  });
  test("long frames after the measured window but before idle are excluded", () => {
    const value = fixture();
    value.recorder.noteScrollIntent(); value.recorder.noteScroll(scroll);
    value.at(16); value.frame();
    value.at(32); value.frame();
    value.at(48); value.frame();
    value.at(140); value.longFrame(120, 20);
    value.at(300); value.idle();
    expect(value.sent[0]).toMatchObject({ kind: "home-scroll", longFrameCount: 0, longFrameMs: 0 });
  });
  test("long frames during a pause between scroll segments are excluded", () => {
    const value = fixture();
    value.recorder.noteScrollIntent(); value.recorder.noteScroll(scroll);
    value.at(16); value.frame();
    value.at(32); value.frame();
    value.at(48); value.frame();
    value.at(180); value.longFrame(120, 30); value.recorder.noteScroll(scroll);
    value.at(196); value.frame();
    value.at(212); value.frame();
    value.at(228); value.frame();
    value.at(480); value.idle();
    expect(value.sent[0]).toMatchObject({ kind: "home-scroll", frameCount: 6,
      longFrameCount: 0, longFrameMs: 0 });
  });
  test("long frames overlapping a measured segment count their full duration", () => {
    const value = fixture();
    value.recorder.noteScrollIntent(); value.recorder.noteScroll(scroll);
    value.at(16); value.frame();
    value.at(32); value.frame();
    value.at(48); value.frame();
    value.at(110); value.longFrame(90, 40);
    value.at(300); value.idle();
    expect(value.sent[0]).toMatchObject({ kind: "home-scroll", longFrameCount: 1, longFrameMs: 40 });
  });
  test("scroll stops counting frames after 100 ms without scroll events", () => {
    const value = fixture();
    value.recorder.noteScrollIntent(); value.recorder.noteScroll(scroll);
    value.at(16); value.frame();
    value.at(32); value.frame();
    value.at(48); value.frame();
    value.at(149); value.frame();
    expect(value.frames.size).toBe(0);
    value.at(300); value.idle();
    expect(value.sent).toEqual([{ version: 1, kind: "home-scroll", route: "/home",
      cache: "retained", device: "mobile-low", engine: "webkit", durationMs: 0, frameCount: 3,
      slowFrameCount: 0, maxFrameMs: 20, longFrameCount: 0, longFrameMs: 0 }]);
  });
  test("scroll resumes after a pause without treating the pause as a slow frame", () => {
    const value = fixture();
    value.recorder.noteScrollIntent(); value.recorder.noteScroll(scroll);
    value.at(16); value.frame();
    value.at(32); value.frame();
    value.at(48); value.frame();
    value.at(149); value.frame();
    value.at(180); value.recorder.noteScroll(scroll);
    expect(value.frames.size).toBe(1);
    value.at(196); value.frame();
    value.at(212); value.frame();
    value.at(228); value.frame();
    value.at(480); value.idle();
    expect(value.sent).toEqual([{ version: 1, kind: "home-scroll", route: "/home",
      cache: "retained", device: "mobile-low", engine: "webkit", durationMs: 200, frameCount: 6,
      slowFrameCount: 0, maxFrameMs: 20, longFrameCount: 0, longFrameMs: 0 }]);
    expect(value.frames.size).toBe(0);
  });
  test("scroll duration ends at the last scroll event, not the idle timeout", () => {
    const value = fixture();
    value.recorder.noteScrollIntent(); value.recorder.noteScroll(scroll);
    value.at(16); value.frame();
    value.at(32); value.frame();
    value.at(48); value.frame();
    value.at(75); value.recorder.noteScroll(scroll);
    value.at(375); value.idle();
    expect(value.sent).toHaveLength(1);
    expect(value.sent[0]).toMatchObject({ kind: "home-scroll", durationMs: 100, frameCount: 3 });
  });
  test("short, hidden and route-changed sessions are discarded", () => {
    const short = fixture();
    short.recorder.noteScrollIntent(); short.recorder.noteScroll(scroll);
    short.frame(); short.idle();
    expect(short.sent).toEqual([]);
    const hidden = fixture();
    hidden.recorder.noteScrollIntent(); hidden.recorder.noteScroll(scroll);
    hidden.frame(); hidden.frame(); hidden.frame(); hidden.hide(); hidden.idle();
    expect(hidden.sent).toEqual([]);
    const changed = fixture();
    changed.recorder.noteScrollIntent(); changed.recorder.noteScroll(scroll);
    changed.frame(); changed.recorder.noteScroll({ ...scroll, route: "/cash" });
    changed.idle(); expect(changed.sent).toEqual([]);
    expect(changed.frames.size).toBe(0);
  });
  test("hiding discards active scrolling before the tab becomes visible again", () => {
    const value = fixture();
    value.recorder.noteScrollIntent(); value.recorder.noteScroll(scroll);
    value.at(16); value.frame();
    value.at(32); value.frame();
    value.at(48); value.frame();
    value.hide(); value.show();
    expect(value.frames.size).toBe(0);
    expect(value.timers.size).toBe(0);
    value.at(300); value.idle();
    expect(value.sent).toEqual([]);
  });
  test("navigation start and explicit discard cancel active scrolling", () => {
    const value = fixture();
    value.recorder.noteScrollIntent(); value.recorder.noteScroll(scroll);
    value.recorder.beginNavigation(navigation);
    expect(value.frames.size).toBe(0);
    value.recorder.noteScrollIntent(); value.recorder.noteScroll(scroll);
    value.recorder.discardScroll(); value.idle();
    expect(value.sent).toEqual([]);
  });
  test("unsupported observer omits long-frame fields and scroll reports are capped", () => {
    const value = fixture({ supported: false });
    for (let i = 0; i < 11; i++) {
      value.recorder.noteScrollIntent(); value.recorder.noteScroll(scroll);
      value.frame(); value.frame(); value.frame(); value.idle();
    }
    expect(value.sent).toHaveLength(10);
    expect(value.sent[0]).not.toHaveProperty("longFrameCount");
    expect(value.sent[0]).not.toHaveProperty("longFrameMs");
  });
  test("swallows synchronous send failures", () => {
    const recorder = createHomeInteractionRecorder({
      now: () => 1, random: () => 0, sampleRate: 1, device: () => "mobile-low",
      engine: () => "webkit", isVisible: () => true,
      requestFrame: (run) => { run(); return 1; }, cancelFrame: () => {},
      scheduleTimeout: (run) => { run(); return 1 as unknown as ReturnType<typeof setTimeout>; },
      clearTimeout: () => {}, observeLongFrames: () => null,
      send: () => { throw new Error("network"); },
    });
    expect(() => { recorder.beginNavigation(navigation); recorder.commitNavigation("/cash"); }).not.toThrow();
  });
});

test("device classes use coarse pointer and known low hardware first", () => {
  for (const [input, expected] of [
    [{ coarsePointer: true }, "mobile-unknown"],
    [{ coarsePointer: false }, "desktop-unknown"],
    [{ coarsePointer: true, hardwareConcurrency: 8, deviceMemory: 4 }, "mobile-low"],
    [{ coarsePointer: false, hardwareConcurrency: 4, deviceMemory: 8 }, "desktop-low"],
    [{ coarsePointer: true, hardwareConcurrency: 8 }, "mobile-high"],
    [{ coarsePointer: false, deviceMemory: 8 }, "desktop-high"],
  ] as const) expect(classifyHomeDevice(input)).toBe(expected);
});

test("engine classification prioritizes iOS and iPadOS over browser tokens", () => {
  for (const [userAgent, expected] of [
    ["Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1 CriOS/120.0", "webkit"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1 Mobile/15E148", "webkit"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1 FxiOS/122.0", "webkit"],
    ["Mozilla/5.0 (iPod touch; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1 EdgiOS/120.0", "webkit"],
    ["Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Edg/120.0", "chromium"],
    ["Mozilla/5.0 (Linux) Chromium/120.0", "chromium"],
    ["Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/120.0", "gecko"],
    ["Mozilla/5.0 (Macintosh) AppleWebKit/605.1 Safari/605.1", "webkit"],
    ["", "other"],
  ] as const) expect(classifyHomeEngine(userAgent)).toBe(expected);
});

test("sample-rate override accepts decimals in range or uses default", () => {
  for (const [raw, expected] of [[undefined, 0.25], ["0", 0], ["1", 1], ["0.25", 0.25],
    ["1.0", 1], ["-0.1", 0.25], ["1.1", 0.25], ["no", 0.25], ["", 0.25]] as const) {
    expect(resolveHomeInteractionSampleRate(raw)).toBe(expected);
  }
});
