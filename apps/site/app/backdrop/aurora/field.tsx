"use client";

import { useEffect, useRef } from "react";
import { fragmentSources, vertexSource, type FieldMode } from "./shaders";
import styles from "./aurora.module.css";

const bleed = 180;
const maxPixels = 640_000;

type Config = { bg: [number, number, number]; travel: number; guardAll: number; intensity: number };

const light: Record<Exclude<FieldMode, "hero">, Config> = {
  customers: { bg: [0.913, 0.913, 0.913], travel: 1, guardAll: 0, intensity: 1 },
  team: { bg: [1, 1, 1], travel: 0, guardAll: 1, intensity: 0.8 },
};

type Layout = {
  width: number;
  height: number;
  docTop: number;
  regionHeight: number;
  viewport: number;
  guard: [number, number, number, number];
  column: [number, number, number, number];
  edge: [number, number];
};

function relative(el: Element | null | undefined, origin: DOMRect, pad: number): [number, number, number, number] {
  if (!el) return [0, 0, 0, 0];
  const r = el.getBoundingClientRect();
  return [(r.left - origin.left - pad) / 1000, (r.top - origin.top - pad) / 1000, (r.right - origin.left + pad) / 1000, (r.bottom - origin.top + pad) / 1000];
}

function measure(mode: FieldMode, region: HTMLElement, canvas: HTMLCanvasElement): Layout {
  const origin = region.getBoundingClientRect();
  const content = region.querySelector(":scope > :not([data-aurora-layer])");
  const copy = region.querySelector(mode === "hero" ? "h1" : "h2")?.parentElement;
  const firstFeature = region.querySelector("section");
  const regionHeight = origin.height;
  const fade = firstFeature ? (firstFeature.getBoundingClientRect().top - origin.top) / 1000 : 0.6;
  return {
    width: canvas.clientWidth,
    height: canvas.clientHeight,
    docTop: origin.top + window.scrollY,
    regionHeight,
    viewport: window.innerHeight,
    guard: relative(copy, origin, 20),
    column: relative(content?.firstElementChild ?? content, origin, 0),
    edge: mode === "hero" ? [regionHeight / 1000, (regionHeight + bleed) / 1000] : [mode === "team" ? 0.5 : fade, 0],
  };
}

function compile(gl: WebGLRenderingContext, mode: FieldMode) {
  const shader = (type: number, source: string) => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, source);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const vs = shader(gl.VERTEX_SHADER, vertexSource);
  const fs = shader(gl.FRAGMENT_SHADER, fragmentSources[mode]);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, "aPos");
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const names = ["uRes", "uScale", "uTime", "uPointer", "uPointerOn", "uScroll", "uView", "uGuard", "uColumn", "uEdge", "uBg", "uTravel", "uGuardAll", "uIntensity"] as const;
  const u = Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(program, n)])) as Record<(typeof names)[number], WebGLUniformLocation | null>;
  if (mode !== "hero") {
    const c = light[mode];
    gl.uniform3f(u.uBg, ...c.bg);
    gl.uniform1f(u.uTravel, c.travel);
    gl.uniform1f(u.uGuardAll, c.guardAll);
    gl.uniform1f(u.uIntensity, c.intensity);
  }
  return u;
}

export function AuroraField({ mode }: { mode: FieldMode }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const layer = canvas?.parentElement;
    const region = canvas?.closest<HTMLElement>("[data-aurora-region]");
    if (!canvas || !layer || !region) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let gl: WebGLRenderingContext | null = null;
    let u: ReturnType<typeof compile> = null;
    let layout = measure(mode, region, canvas);
    let scale = 0.5;
    let frame = 0;
    let visible = false;
    let last = 0;
    let time = 20 + Math.random() * 40;
    const pointer = { x: 0, y: 0, on: 0, tx: 0, ty: 0, ton: 0, seeded: false };
    let view = 0;

    const setup = () => {
      gl = canvas.getContext("webgl", { premultipliedAlpha: true, antialias: false, alpha: true, powerPreference: "low-power" });
      u = gl ? compile(gl, mode) : null;
      if (!u) gl = null;
    };

    const resize = () => {
      layout = measure(mode, region, canvas);
      const px = layout.width * layout.height;
      scale = Math.min(0.5, Math.sqrt(maxPixels / Math.max(px, 1)), (window.devicePixelRatio || 1) * 0.5);
      canvas.width = Math.max(1, Math.round(layout.width * scale));
      canvas.height = Math.max(1, Math.round(layout.height * scale));
      if (!gl || !u) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(u.uRes, canvas.width, canvas.height);
      gl.uniform1f(u.uScale, (canvas.width / Math.max(layout.width, 1)) * 1000);
      gl.uniform4f(u.uGuard, ...layout.guard);
      gl.uniform4f(u.uColumn, ...layout.column);
      gl.uniform2f(u.uEdge, ...layout.edge);
      if (!frame) draw(0);
    };

    const draw = (dt: number) => {
      if (!gl || !u) return;
      const ease = 1 - Math.exp(-dt * 2.4);
      pointer.x += (pointer.tx - pointer.x) * ease;
      pointer.y += (pointer.ty - pointer.y) * ease;
      pointer.on += (pointer.ton - pointer.on) * ease;
      const scrollY = window.scrollY;
      const progress = (scrollY - layout.docTop) / Math.max(layout.regionHeight, 1);
      const viewTarget = (scrollY + layout.viewport * 0.5 - layout.docTop) / 1000;
      view = dt === 0 ? viewTarget : view + (viewTarget - view) * (1 - Math.exp(-dt * 1.6));
      gl.uniform1f(u.uTime, time);
      gl.uniform2f(u.uPointer, pointer.x, pointer.y);
      gl.uniform1f(u.uPointerOn, pointer.on);
      gl.uniform1f(u.uScroll, Math.min(Math.max(progress, 0), 1));
      gl.uniform1f(u.uView, view);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!layer.dataset.ready) layer.dataset.ready = "";
    };

    const loop = (now: number) => {
      const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
      last = now;
      time += dt;
      draw(dt);
      frame = requestAnimationFrame(loop);
    };

    const start = () => {
      if (frame || !gl || reduce.matches || !visible || document.hidden) return;
      last = 0;
      frame = requestAnimationFrame(loop);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const sync = () => {
      if (reduce.matches || !visible || document.hidden) {
        stop();
        draw(0);
      } else start();
    };

    const onPointer = (e: PointerEvent) => {
      if (e.pointerType === "touch" || reduce.matches) return;
      pointer.tx = e.clientX / 1000;
      pointer.ty = (e.clientY + window.scrollY - layout.docTop) / 1000;
      pointer.ton = 1;
      if (!pointer.seeded) {
        pointer.seeded = true;
        pointer.x = pointer.tx;
        pointer.y = pointer.ty;
      }
    };
    const onLeave = () => {
      pointer.ton = 0;
    };
    const onLost = (e: Event) => {
      e.preventDefault();
      stop();
      gl = null;
      u = null;
      delete layer.dataset.ready;
    };
    const onRestored = () => {
      setup();
      resize();
      sync();
    };

    setup();
    resize();
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    io.observe(canvas);
    const ro = new ResizeObserver(resize);
    ro.observe(region);
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointer, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", sync);
    reduce.addEventListener("change", sync);
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointer);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", sync);
      reduce.removeEventListener("change", sync);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
    };
  }, [mode]);

  return <canvas ref={ref} className={styles.canvas} />;
}
