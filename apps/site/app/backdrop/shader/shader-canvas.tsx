"use client";

import { useEffect, useRef } from "react";
import { fragmentSource, vertexSource } from "./fragment";
import styles from "./shader.module.css";

const DPR_CAP = 1.5;
const RENDER_SCALE = 0.6;
const COPY_PAD = 36;
const SPEED = 0.24;
const CALM_SLOWDOWN = 0.7;

const uniformNames = ["uRes", "uTime", "uPointer", "uPointerVel", "uPointerOn", "uCalm", "uCopy", "uFade", "uScale"] as const;
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
  const uniforms = Object.fromEntries(uniformNames.map((name) => [name, gl.getUniformLocation(program, name)])) as Uniforms;
  return uniforms;
}

export function ShaderCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const root = canvas?.closest<HTMLElement>("[data-shader-root]");
    const copy = root?.querySelector<HTMLElement>("[data-shader-copy]");
    if (!canvas || !root || !copy) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let gl: WebGL2RenderingContext | null = null;
    let uniforms: Uniforms | null = null;
    let frame = 0;
    let visible = true;
    let lost = false;
    let last = 0;
    let time = 7.3;

    const size = { w: 1, h: 1, scale: 1, rootTop: 0, rootHeight: 1 };
    const copyRect = [0, 0, 0, 0];
    const fade = [0, 1];
    const pointer = { x: 0, y: 0, tx: 0, ty: 0, vx: 0, vy: 0, on: 0, target: 0, lastX: 0, lastY: 0 };
    let scrollY = window.scrollY;

    const measure = () => {
      const canvasBox = canvas.getBoundingClientRect();
      const rootBox = root.getBoundingClientRect();
      const scale = Math.min(window.devicePixelRatio || 1, DPR_CAP) * RENDER_SCALE;
      size.scale = scale;
      size.w = Math.max(1, Math.round(canvasBox.width * scale));
      size.h = Math.max(1, Math.round(canvasBox.height * scale));
      size.rootTop = rootBox.top + window.scrollY;
      size.rootHeight = rootBox.height;
      canvas.width = size.w;
      canvas.height = size.h;
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
      fade[0] = copyRect[3] + 24 * scale;
      fade[1] = size.h;
      pointer.x = pointer.tx = size.w * 0.78;
      pointer.y = pointer.ty = size.h * 0.4;
      if (gl) gl.viewport(0, 0, size.w, size.h);
    };

    const draw = () => {
      if (!gl || !uniforms) return;
      const calm = Math.min(1, Math.max(0, (scrollY - size.rootTop + 64) / (size.rootHeight * 0.8)));
      gl.uniform2f(uniforms.uRes, size.w, size.h);
      gl.uniform1f(uniforms.uTime, time);
      gl.uniform2f(uniforms.uPointer, pointer.x, pointer.y);
      gl.uniform2f(uniforms.uPointerVel, pointer.vx, pointer.vy);
      gl.uniform1f(uniforms.uPointerOn, pointer.on);
      gl.uniform1f(uniforms.uCalm, calm);
      gl.uniform4f(uniforms.uCopy, copyRect[0], copyRect[1], copyRect[2], copyRect[3]);
      gl.uniform2f(uniforms.uFade, fade[0], fade[1]);
      gl.uniform1f(uniforms.uScale, size.scale);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return calm;
    };

    const tick = (now: number) => {
      frame = 0;
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
      last = now;
      const k = 1 - Math.exp(-dt * 6);
      const prevX = pointer.x;
      const prevY = pointer.y;
      pointer.x += (pointer.tx - pointer.x) * k;
      pointer.y += (pointer.ty - pointer.y) * k;
      pointer.on += (pointer.target - pointer.on) * (1 - Math.exp(-dt * 3));
      const unit = Math.max(size.w * 0.42, 520 * size.scale);
      const vx = ((pointer.x - prevX) / unit / Math.max(dt, 0.001)) * 0.12;
      const vy = ((pointer.y - prevY) / unit / Math.max(dt, 0.001)) * 0.12;
      pointer.vx += (vx - pointer.vx) * k;
      pointer.vy += (vy - pointer.vy) * k;
      const calm = Math.min(1, Math.max(0, (scrollY - size.rootTop + 64) / (size.rootHeight * 0.8)));
      time += dt * SPEED * (1 - CALM_SLOWDOWN * calm);
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
      draw();
      root.dataset.shaderState = "live";
      schedule();
    };

    const onPointer = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const box = canvas.getBoundingClientRect();
      const inside = event.clientY >= box.top && event.clientY <= box.bottom;
      pointer.tx = (event.clientX - box.left) * size.scale;
      pointer.ty = (event.clientY - box.top) * size.scale;
      pointer.target = inside ? 1 : 0;
    };
    const onLeave = () => {
      pointer.target = 0;
    };
    const onScroll = () => {
      scrollY = window.scrollY;
      if (reduce.matches) draw();
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else schedule();
    };
    const onMotion = () => {
      if (reduce.matches) {
        stop();
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
      measure();
      draw();
    });
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) schedule();
      else stop();
    });

    init();
    resize.observe(root);
    io.observe(canvas);
    window.addEventListener("pointermove", onPointer, { passive: true });
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
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
      reduce.removeEventListener("change", onMotion);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
    };
  }, []);

  return <canvas ref={ref} className={styles.canvas} />;
}
