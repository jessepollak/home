import { describe, expect, spyOn, test } from "bun:test";
import { createGlobeRenderer } from "./globe-renderer";

class Target extends EventTarget {
  listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) {
    if (listener) {
      const listeners = this.listeners.get(type) ?? new Set();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    }
    super.addEventListener(type, listener, options);
  }
  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean) {
    if (listener) this.listeners.get(type)?.delete(listener);
    super.removeEventListener(type, listener, options);
  }
  get listenerCount() { return [...this.listeners.values()].reduce((count, listeners) => count + listeners.size, 0); }
}

function harness(run: (h: ReturnType<typeof setup>) => void) {
  const h = setup();
  try { run(h); } finally { h.cleanup(); }
}

function setup() {
  let now = 0;
  let draws = 0;
  let unavailable = 0;
  let longitude = -28;
  const deleted = { buffers: 0, programs: 0, shaders: 0, contexts: 0 };
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  const windowTarget = Object.assign(new Target(), { devicePixelRatio: 3 });
  const documentTarget = Object.assign(new Target(), { hidden: false });
  const captures = new Set<number>();
  const attributes = new Map<string, string>();
  const stage = Object.assign(new Target(), {
    getBoundingClientRect: () => ({ width: 400 }),
    setAttribute: (key: string, value: string) => attributes.set(key, value),
    removeAttribute: (key: string) => attributes.delete(key),
    setPointerCapture: (id: number) => captures.add(id),
    hasPointerCapture: (id: number) => captures.has(id),
    releasePointerCapture: (id: number) => captures.delete(id),
  });
  const gl = new Proxy({
    createBuffer: () => ({}), createProgram: () => ({}), createShader: () => ({}),
    getShaderParameter: () => true, getProgramParameter: () => true,
    getAttribLocation: () => 0, getUniformLocation: () => ({}),
    drawArrays: () => { draws++; },
    deleteBuffer: () => { deleted.buffers++; },
    deleteProgram: () => { deleted.programs++; },
    deleteShader: () => { deleted.shaders++; },
    getExtension: () => ({ loseContext: () => { deleted.contexts++; } }),
  }, { get: (target, key) => key in target ? target[key as keyof typeof target] : () => {} });
  const canvas = Object.assign(new Target(), { clientWidth: 400, width: 0, height: 0, getContext: () => gl });
  const observers: Observer[] = [];
  class Observer {
    connected = false;
    constructor(public callback: (entries: { isIntersecting: boolean }[]) => void) { observers.push(this); }
    observe() { this.connected = true; }
    disconnect() { this.connected = false; }
  }
  const globals = {
    window: windowTarget, document: documentTarget,
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id: number) => { frames.delete(id); },
    ResizeObserver: Observer, IntersectionObserver: Observer,
  };
  const originals = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const clock = spyOn(performance, "now").mockImplementation(() => now);
  const renderer = createGlobeRenderer(canvas as unknown as HTMLCanvasElement, stage as unknown as HTMLDivElement,
    (value) => { longitude = value; }, () => { unavailable++; });

  function advance(milliseconds: number) {
    const end = now + milliseconds;
    while (now < end) {
      now = Math.min(end, now + 1000 / 60);
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(now));
    }
  }
  function pointer(type: string, x: number, y = 100, id = 1, isPrimary = true) {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { clientX: x, clientY: y, pointerId: id, isPrimary, button: 0 });
    stage.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }
  function flick() {
    pointer("pointerdown", 260);
    advance(20);
    pointer("pointermove", 210);
    advance(20);
    pointer("pointermove", 160);
    pointer("pointerup", 160);
    advance(50);
  }
  return {
    renderer, canvas, stage, observers, captures, frames, deleted, documentTarget, windowTarget,
    advance, pointer, flick,
    get longitude() { return longitude; }, get draws() { return draws; }, get unavailable() { return unavailable; },
    cleanup() {
      renderer.dispose();
      clock.mockRestore();
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

describe("globe rendering and pointer lifecycle", () => {
  test("caps DPR, buffer size and frame rate; drag accelerates then decays", () => harness((h) => {
    expect(h.canvas.width).toBe(600);
    h.canvas.clientWidth = 1000;
    h.windowTarget.dispatchEvent(new Event("resize"));
    expect(h.canvas.width).toBe(960);
    h.renderer.setMotion(true);
    const before = h.draws;
    h.advance(1000);
    expect((h.draws - before) / 2).toBeLessThanOrEqual(30);
    expect(h.longitude).toBeCloseTo(-25.5, 0);
    h.flick();
    let start = h.longitude;
    h.advance(100);
    const fast = h.longitude - start;
    expect(fast).toBeGreaterThan(8);
    h.advance(6000);
    start = h.longitude;
    h.advance(100);
    expect(h.longitude - start).toBeLessThan(1);
    expect(h.captures.size).toBe(0);
  }));

  test("paused/reduced-motion drag and keyboard rotation never start inertia", () => harness((h) => {
    h.flick();
    const afterDrag = h.longitude;
    expect(afterDrag).toBeGreaterThan(-28);
    h.advance(1000);
    expect(h.longitude).toBe(afterDrag);
    expect(h.frames.size).toBe(0);
    h.renderer.rotate(-12);
    h.advance(100);
    expect(h.longitude).toBeCloseTo(afterDrag - 12, 8);
    expect(h.frames.size).toBe(0);
    h.renderer.setMotion(true);
    h.advance(100);
    expect(h.longitude).toBeGreaterThan(afterDrag - 12);
    h.renderer.setMotion(false);
    h.advance(100);
    expect(h.frames.size).toBe(0);
  }));

  test("vertical scroll, pinch, cancellation and repeated drags leave no capture or stale flick", () => harness((h) => {
    h.renderer.setMotion(true);
    h.pointer("pointerdown", 200);
    h.pointer("pointermove", 201, 140);
    expect(h.captures.size).toBe(0);
    for (const type of ["pointercancel", "lostpointercapture"]) {
      h.pointer("pointerdown", 200);
      h.advance(20);
      h.pointer("pointermove", 100);
      h.pointer(type, 100);
      expect(h.captures.size).toBe(0);
      h.advance(50);
      const start = h.longitude;
      h.advance(100);
      expect(Math.abs(h.longitude - start)).toBeLessThan(1);
    }
    h.pointer("pointerdown", 200);
    h.pointer("pointerdown", 240, 100, 2, false);
    expect(h.captures.size).toBe(0);
    for (let i = 0; i < 10; i++) h.flick();
    expect(h.captures.size).toBe(0);
    expect(h.frames.size).toBe(1);
    h.pointer("pointerdown", 200);
    h.advance(20);
    h.pointer("pointermove", 100);
    h.advance(200); // Holding at rest must not retain an earlier flick velocity.
    h.pointer("pointerup", 100);
    const start = h.longitude;
    h.advance(100);
    expect(Math.abs(h.longitude - start)).toBeLessThan(1);
  }));

  test("hidden and offscreen suspension discard inertia, with no elapsed-time jump on return", () => harness((h) => {
    h.renderer.setMotion(true);
    h.flick();
    h.pointer("pointerdown", 200);
    h.pointer("pointermove", 100); // Undrawn update must not reappear after suspension.
    h.documentTarget.hidden = true;
    h.documentTarget.dispatchEvent(new Event("visibilitychange"));
    const start = h.longitude;
    h.advance(60_000);
    expect(h.frames.size).toBe(0);
    expect(h.longitude).toBe(start);
    h.documentTarget.hidden = false;
    h.documentTarget.dispatchEvent(new Event("visibilitychange"));
    h.advance(100);
    expect(h.longitude - start).toBeLessThan(1);
    h.observers[1].callback([{ isIntersecting: false }]);
    const offscreen = h.longitude;
    h.advance(60_000);
    expect(h.longitude).toBe(offscreen);
    expect(h.frames.size).toBe(0);
    h.observers[1].callback([{ isIntersecting: true }]);
    h.advance(100);
    expect(h.longitude - offscreen).toBeLessThan(1);
  }));

  test("unmount and context loss fully release GPU, listeners, capture, observers and rAF", () => {
    for (const contextLoss of [false, true]) harness((h) => {
      h.renderer.setMotion(true);
      h.pointer("pointerdown", 200);
      if (contextLoss) h.canvas.dispatchEvent(new Event("webglcontextlost"));
      else h.renderer.dispose();
      expect(h.unavailable).toBe(contextLoss ? 1 : 0);
      expect(h.deleted).toEqual({ buffers: 2, programs: 2, shaders: 4, contexts: 1 });
      expect(h.stage.listenerCount + h.canvas.listenerCount + h.documentTarget.listenerCount + h.windowTarget.listenerCount).toBe(0);
      expect(h.observers.every((observer) => !observer.connected)).toBe(true);
      expect(h.captures.size).toBe(0);
      expect(h.frames.size).toBe(0);
      const draws = h.draws;
      h.renderer.rotate(12);
      h.renderer.setMotion(true);
      h.advance(1000);
      expect(h.draws).toBe(draws);
      h.renderer.dispose();
      expect(h.deleted.contexts).toBe(1);
    });
  });
});
