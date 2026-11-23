"use client";

import { useEffect, useRef } from "react";
import { PULSE_SLOTS, TRAIL_SLOTS, fragmentSource, vertexSource } from "./fragment";
import styles from "./shader.module.css";

export type ShaderPlacement = "hero" | "team" | "talk";

const DPR_CAP = 1.5;
const RENDER_SCALE = 0.6;
const COPY_PAD = 36;
const SPEED = 0.16;
const CALM_SLOWDOWN = 0.45;
const SCROLL_DRIVE = 0.00055;
const SCROLL_DRIVE_MAX = 2600;
const INTRO_SECONDS = 1.6;
const INTRO_SWEEP = 0.9;
const TRAIL_INTERVAL = 0.055;
const TRAIL_LIFE = TRAIL_INTERVAL * TRAIL_SLOTS;
const PULSE_LIFE = 2.6;
const REST_TIME = 7.3;

const uniformNames = ["uRes", "uTime", "uClock", "uPointer", "uPointerOn", "uCalm", "uIntro", "uCopy", "uFade", "uScale", "uTrail", "uPulse"] as const;
type Uniforms = Record<(typeof uniformNames)[number], WebGLUniformLocation | null>;

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function setup(gl: WebGL2RenderingContext) {
  const vs = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  return Object.fromEntries(uniformNames.map((name) => [name, gl.getUniformLocation(program, name)])) as Uniforms;
}

const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;

export function ShaderCanvas({ placement }: { placement: ShaderPlacement }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const root = canvas?.closest<HTMLElement>("[data-shader-root]");
    if (!canvas || !root) return;
    const copy = placement === "hero" ? root.querySelector<HTMLElement>("[data-shader-copy]") : null;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let gl: WebGL2RenderingContext | null = null;
    let uniforms: Uniforms | null = null;
    let frame = 0;
    let visible = false;
    let lost = false;
    let last = 0;
    let time = REST_TIME;
    let clock = 0;
    let introAt = placement === "hero" && !reduce.matches ? 0 : -1;
    let intro = 0;

    const size = { w: 1, h: 1, scale: 1, unit: 1, rootTop: 0, rootHeight: 1, left: 0, top: 0 };
    const copyRect = [-1e5, -1e5, -1e5, -1e5];
    const fade = [-2, -1, 1e6, 1e6 + 1];
    const pointer = { x: 0, y: 0, tx: 0, ty: 0, vx: 0, vy: 0, on: 0, target: 0, clientX: -1, clientY: -1 };
    const trail = new Float32Array(TRAIL_SLOTS * 4);
    const trailAge = new Float32Array(TRAIL_SLOTS).fill(TRAIL_LIFE);
    const trailVel = new Float32Array(TRAIL_SLOTS * 2);
    let trailHead = 0;
    let trailClock = 0;
    const pulses = new Float32Array(PULSE_SLOTS * 4);
    let pulseHead = 0;
    let scrollY = window.scrollY;
    let lastScroll = scrollY;
    let scrollDrive = 0;

    const toCanvas = () => {
      pointer.tx = (pointer.clientX - size.left) * size.scale;
      pointer.ty = (pointer.clientY - (size.top - scrollY)) * size.scale;
    };

    const measure = () => {
      const canvasBox = canvas.getBoundingClientRect();
      const rootBox = root.getBoundingClientRect();
      const scale = Math.min(window.devicePixelRatio || 1, DPR_CAP) * RENDER_SCALE;
      scrollY = window.scrollY;
      size.scale = scale;
      size.w = Math.max(1, Math.round(canvasBox.width * scale));
      size.h = Math.max(1, Math.round(canvasBox.height * scale));
      size.unit = Math.max(size.w * 0.42, 520 * scale);
      size.left = canvasBox.left;
      size.top = canvasBox.top + scrollY;
      size.rootTop = rootBox.top + scrollY;
      size.rootHeight = rootBox.height;
      if (canvas.width !== size.w || canvas.height !== size.h) {
        canvas.width = size.w;
        canvas.height = size.h;
      }
      if (copy) {
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (const el of copy.querySelectorAll("h1, p, a")) {
          const box = el.getBoundingClientRect();
          x0 = Math.min(x0, box.left);
          y0 = Math.min(y0, box.top);
          x1 = Math.max(x1, box.right);
          y1 = Math.max(y1, box.bottom);
        }
        if (!Number.isFinite(x0)) {
          const box = copy.getBoundingClientRect();
          [x0, y0, x1, y1] = [box.left, box.top, box.right, box.bottom];
        }
        copyRect[0] = (x0 - canvasBox.left - COPY_PAD) * scale;
        copyRect[1] = (y0 - canvasBox.top - COPY_PAD) * scale;
        copyRect[2] = (x1 - canvasBox.left + COPY_PAD) * scale;
        copyRect[3] = (y1 - canvasBox.top + COPY_PAD) * scale;
        fade[2] = copyRect[3] + 24 * scale;
        fade[3] = size.h;
      } else if (placement === "team") {
        fade[2] = size.h * 0.05;
        fade[3] = size.h;
      } else {
        fade[1] = size.h * 0.4;
        fade[2] = size.h * 0.6;
        fade[3] = size.h;
      }
      if (pointer.target === 0) {
        pointer.x = pointer.tx = size.w * 0.78;
        pointer.y = pointer.ty = size.h * 0.4;
      } else toCanvas();
      if (gl) gl.viewport(0, 0, size.w, size.h);
    };

    const calmFor = () => (placement === "hero" ? Math.min(1, Math.max(0, (scrollY - size.rootTop + 64) / (size.rootHeight * 0.8))) : 0);

    const draw = () => {
      if (!gl || !uniforms) return;
      gl.uniform2f(uniforms.uRes, size.w, size.h);
      gl.uniform1f(uniforms.uTime, time + INTRO_SWEEP * (easeOutCubic(1 - intro) - 1));
      gl.uniform1f(uniforms.uClock, clock);
      gl.uniform2f(uniforms.uPointer, pointer.x, pointer.y);
      gl.uniform1f(uniforms.uPointerOn, pointer.on);
      gl.uniform1f(uniforms.uCalm, reduce.matches ? 0 : calmFor());
      gl.uniform1f(uniforms.uIntro, 1 - easeOutCubic(1 - intro));
      gl.uniform4f(uniforms.uCopy, copyRect[0], copyRect[1], copyRect[2], copyRect[3]);
      gl.uniform4f(uniforms.uFade, fade[0], fade[1], fade[2], fade[3]);
      gl.uniform1f(uniforms.uScale, size.scale);
      gl.uniform4fv(uniforms.uTrail, trail);
      gl.uniform4fv(uniforms.uPulse, pulses);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const pulse = (x: number, y: number, strength: number) => {
      const i = pulseHead * 4;
      pulses[i] = x;
      pulses[i + 1] = y;
      pulses[i + 2] = clock;
      pulses[i + 3] = strength;
      pulseHead = (pulseHead + 1) % PULSE_SLOTS;
    };

    const tick = (now: number) => {
      frame = 0;
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
      last = now;
      clock += dt;
      if (introAt >= 0) {
        intro = Math.max(0, 1 - (clock - introAt) / INTRO_SECONDS);
        if (intro === 0) introAt = -1;
      }

      const k = 1 - Math.exp(-dt * 7);
      const prevX = pointer.x;
      const prevY = pointer.y;
      pointer.x += (pointer.tx - pointer.x) * k;
      pointer.y += (pointer.ty - pointer.y) * k;
      pointer.on += (pointer.target - pointer.on) * (1 - Math.exp(-dt * 3));
      const vx = (pointer.x - prevX) / size.unit / Math.max(dt, 0.001);
      const vy = (pointer.y - prevY) / size.unit / Math.max(dt, 0.001);
      pointer.vx += (vx - pointer.vx) * k;
      pointer.vy += (vy - pointer.vy) * k;

      trailClock += dt;
      if (trailClock >= TRAIL_INTERVAL) {
        trailClock = 0;
        const i = trailHead;
        trail[i * 4] = pointer.x;
        trail[i * 4 + 1] = pointer.y;
        trailVel[i * 2] = pointer.vx * pointer.on;
        trailVel[i * 2 + 1] = pointer.vy * pointer.on;
        trailAge[i] = 0;
        trailHead = (trailHead + 1) % TRAIL_SLOTS;
      }
      for (let i = 0; i < TRAIL_SLOTS; i++) {
        trailAge[i] = Math.min(TRAIL_LIFE, trailAge[i] + dt);
        const weight = (1 - trailAge[i] / TRAIL_LIFE) ** 2;
        trail[i * 4 + 2] = Math.max(-3, Math.min(3, trailVel[i * 2])) * weight;
        trail[i * 4 + 3] = Math.max(-3, Math.min(3, trailVel[i * 2 + 1])) * weight;
      }
      for (let i = 0; i < PULSE_SLOTS; i++) if (pulses[i * 4 + 3] > 0 && clock - pulses[i * 4 + 2] > PULSE_LIFE) pulses[i * 4 + 3] = 0;

      const scrollVel = Math.min(SCROLL_DRIVE_MAX, Math.abs(scrollY - lastScroll) / Math.max(dt, 0.001));
      lastScroll = scrollY;
      scrollDrive += (scrollVel - scrollDrive) * (1 - Math.exp(-dt * (scrollVel > scrollDrive ? 8 : 2.5)));
      time += dt * (SPEED * (1 - CALM_SLOWDOWN * calmFor()) + scrollDrive * SCROLL_DRIVE);
      draw();
      schedule();
    };

    const schedule = () => {
      if (frame || !visible || lost || reduce.matches || document.hidden || !gl) return;
      frame = requestAnimationFrame(tick);
    };

    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
    };

    const init = () => {
      gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: "high-performance" });
      uniforms = gl ? setup(gl) : null;
      if (!gl || !uniforms) {
        gl = null;
        root.dataset.shaderState = "fallback";
        return;
      }
      measure();
      if (introAt >= 0) {
        intro = 1;
        pulse(size.w * 0.74, size.h * 0.42, 0.55);
      }
      draw();
      root.dataset.shaderState = "live";
      schedule();
    };

    const inside = () => pointer.clientX >= size.left && pointer.clientX <= size.left + size.w / size.scale && pointer.clientY >= size.top - scrollY && pointer.clientY <= size.top - scrollY + size.h / size.scale;

    const onPointer = (event: PointerEvent) => {
      if (event.pointerType === "touch" || !visible) return;
      pointer.clientX = event.clientX;
      pointer.clientY = event.clientY;
      toCanvas();
      pointer.target = inside() ? 1 : 0;
    };
    const tap = { x: 0, y: 0, at: -1 };
    const pulseAt = (clientX: number, clientY: number) => {
      if (!visible || reduce.matches || !gl) return;
      pointer.clientX = clientX;
      pointer.clientY = clientY;
      if (inside()) pulse((clientX - size.left) * size.scale, (clientY - (size.top - scrollY)) * size.scale, 1);
    };
    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch") pulseAt(event.clientX, event.clientY);
      else [tap.x, tap.y, tap.at] = [event.clientX, event.clientY, event.timeStamp];
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || tap.at < 0) return;
      const still = Math.hypot(event.clientX - tap.x, event.clientY - tap.y) < 12 && event.timeStamp - tap.at < 500;
      tap.at = -1;
      if (still) pulseAt(event.clientX, event.clientY);
    };
    const onCancel = () => {
      tap.at = -1;
    };
    const onLeave = () => {
      pointer.target = 0;
    };
    const onScroll = () => {
      scrollY = window.scrollY;
      if (pointer.target) {
        toCanvas();
        pointer.target = inside() ? 1 : 0;
      }
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else schedule();
    };
    const onMotion = () => {
      if (reduce.matches) {
        stop();
        intro = 0;
        introAt = -1;
        time = REST_TIME;
        pulses.fill(0);
        trail.fill(0);
        draw();
      } else schedule();
    };
    const onLost = (event: Event) => {
      event.preventDefault();
      lost = true;
      stop();
      root.dataset.shaderState = "fallback";
    };
    const onRestored = () => {
      lost = false;
      init();
    };

    const resize = new ResizeObserver(() => {
      if (!visible && placement !== "hero") return;
      measure();
      if (!frame) draw();
    });
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) {
        measure();
        draw();
        schedule();
      } else {
        stop();
        pointer.target = 0;
      }
    });

    init();
    resize.observe(root);
    resize.observe(document.body);
    io.observe(canvas);
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onCancel, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    reduce.addEventListener("change", onMotion);
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);

    return () => {
      stop();
      resize.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
      reduce.removeEventListener("change", onMotion);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
    };
  }, [placement]);

  return <canvas ref={ref} className={styles.canvas} />;
}
