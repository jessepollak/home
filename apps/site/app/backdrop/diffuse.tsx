"use client";

import { useEffect, useRef } from "react";
import styles from "./diffuse/diffuse.module.css";

const POINTER_EASE = 1.6;
const SCROLL_EASE = 2.4;
const SETTLE = 0.0004;
const FAR = { pointer: 14, scroll: 7 };
const NEAR = { pointer: 30, scroll: 16 };

export function DiffuseBackdrop() {
  const root = useRef<HTMLDivElement>(null);
  const far = useRef<HTMLDivElement>(null);
  const near = useRef<HTMLDivElement>(null);
  const tone = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = root.current;
    const farEl = far.current;
    const nearEl = near.current;
    const toneEl = tone.current;
    if (!layer || !farEl || !nearEl || !toneEl) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduce.matches) return;

    const view = { w: window.innerWidth, h: window.innerHeight, max: 1 };
    const target = { x: 0, y: 0, p: 0 };
    const now = { x: 0, y: 0, p: 0 };
    let frame = 0;
    let last = 0;

    const measure = () => {
      view.w = window.innerWidth;
      view.h = window.innerHeight;
      view.max = Math.max(1, document.documentElement.scrollHeight - view.h);
      target.p = Math.min(1, window.scrollY / view.max);
    };

    const paint = () => {
      const fx = now.x * FAR.pointer;
      const fy = now.y * FAR.pointer - now.p * FAR.scroll * view.h * 0.01;
      const nx = now.x * NEAR.pointer;
      const ny = now.y * NEAR.pointer - now.p * NEAR.scroll * view.h * 0.01;
      farEl.style.transform = `translate3d(${fx.toFixed(2)}px, ${fy.toFixed(2)}px, 0)`;
      nearEl.style.transform = `translate3d(${nx.toFixed(2)}px, ${ny.toFixed(2)}px, 0)`;
      toneEl.style.opacity = (0.35 + now.p * 0.65).toFixed(3);
    };

    const tick = (t: number) => {
      const dt = last ? Math.min(0.05, (t - last) / 1000) : 1 / 60;
      last = t;
      const kp = 1 - Math.exp(-dt * POINTER_EASE);
      const ks = 1 - Math.exp(-dt * SCROLL_EASE);
      now.x += (target.x - now.x) * kp;
      now.y += (target.y - now.y) * kp;
      now.p += (target.p - now.p) * ks;
      paint();
      const settled = Math.abs(target.x - now.x) < SETTLE && Math.abs(target.y - now.y) < SETTLE && Math.abs(target.p - now.p) < SETTLE;
      frame = settled ? 0 : requestAnimationFrame(tick);
      if (settled) last = 0;
    };

    const wake = () => {
      if (!frame && !document.hidden) frame = requestAnimationFrame(tick);
    };

    const onPointer = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      target.x = event.clientX / view.w - 0.5;
      target.y = event.clientY / view.h - 0.5;
      wake();
    };
    const onLeave = () => {
      target.x = 0;
      target.y = 0;
      wake();
    };
    const onScroll = () => {
      target.p = Math.min(1, window.scrollY / view.max);
      wake();
    };
    const onVisibility = () => {
      layer.toggleAttribute("data-paused", document.hidden);
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
        last = 0;
      } else wake();
    };

    const resize = new ResizeObserver(() => {
      measure();
      wake();
    });
    resize.observe(document.body);
    measure();
    now.p = target.p;
    paint();
    layer.setAttribute("data-live", "");

    window.addEventListener("pointermove", onPointer, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", measure);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener("pointermove", onPointer);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", measure);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div ref={root} aria-hidden="true" data-diffuse="" className={styles.field}>
      <div ref={far} className={styles.depth}>
        <span className={`${styles.bloom} ${styles.blueWide}`} />
        <span className={`${styles.bloom} ${styles.greenLow}`} />
      </div>
      <div ref={near} className={styles.depth}>
        <span className={`${styles.bloom} ${styles.blueHigh}`} />
        <span className={`${styles.bloom} ${styles.pinkHigh}`} />
        <span className={`${styles.bloom} ${styles.greenMid}`} />
      </div>
      <div ref={tone} className={styles.tone}>
        <span className={`${styles.bloom} ${styles.pinkLow}`} />
        <span className={`${styles.bloom} ${styles.greenDeep}`} />
      </div>
      <div className={styles.veil} />
    </div>
  );
}
