"use client";

import { useEffect, useRef } from "react";

const restPose = { rx: 58, rz: -30 };

function pose(rx: number, rz: number, ty: number, tz: number) {
  return `translate3d(0, ${ty.toFixed(2)}px, ${tz.toFixed(2)}px) rotateX(${rx.toFixed(3)}deg) rotateZ(${rz.toFixed(3)}deg)`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function useDimensionalMotion() {
  const root = useRef<HTMLDivElement>(null);
  const rig = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scene = root.current;
    const target = rig.current;
    const hero = scene?.parentElement;
    if (!scene || !target || !hero) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = { x: 0, y: 0, cx: 0, cy: 0 };
    const scroll = { value: 0, current: 0 };
    const bounds = { top: 0, height: 1 };
    let frame = 0;
    let last = 0;
    let elapsed = 0;
    let visible = true;

    const measure = () => {
      const rect = hero.getBoundingClientRect();
      bounds.top = rect.top + window.scrollY;
      bounds.height = Math.max(rect.height, 1);
    };
    const readScroll = () => {
      scroll.value = clamp((window.scrollY - bounds.top) / bounds.height, 0, 1.2);
    };
    const onPointer = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      pointer.x = clamp((event.clientX / window.innerWidth) * 2 - 1, -1, 1);
      pointer.y = clamp((event.clientY / window.innerHeight) * 2 - 1, -1, 1);
    };

    const tick = (now: number) => {
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
      last = now;
      elapsed += dt;
      const ease = 1 - Math.exp(-dt * 5);
      pointer.cx += (pointer.x - pointer.cx) * ease;
      pointer.cy += (pointer.y - pointer.cy) * ease;
      scroll.current += (scroll.value - scroll.current) * (1 - Math.exp(-dt * 9));
      const p = scroll.current;
      const rx = restPose.rx + Math.sin(elapsed * 0.31) * 1.6 - pointer.cy * 4 + p * 12;
      const rz = restPose.rz + Math.sin(elapsed * 0.23) * 2 + pointer.cx * 5 - p * 10;
      target.style.transform = pose(rx, rz, p * 200, p * -240);
      scene.style.opacity = String(1 - clamp((p - 0.4) / 0.6, 0, 1));
      frame = requestAnimationFrame(tick);
    };

    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
    };
    const sync = () => {
      const run = visible && !document.hidden && !reduced.matches;
      if (run && !frame) frame = requestAnimationFrame(tick);
      if (!run && frame) stop();
      if (reduced.matches) {
        target.style.transform = "";
        scene.style.opacity = "";
      }
    };

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      sync();
    });
    const resize = new ResizeObserver(() => {
      measure();
      readScroll();
    });

    measure();
    readScroll();
    scroll.current = scroll.value;
    observer.observe(scene);
    resize.observe(hero);
    window.addEventListener("scroll", readScroll, { passive: true });
    window.addEventListener("pointermove", onPointer, { passive: true });
    document.addEventListener("visibilitychange", sync);
    reduced.addEventListener("change", sync);
    sync();

    return () => {
      stop();
      observer.disconnect();
      resize.disconnect();
      window.removeEventListener("scroll", readScroll);
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", sync);
      reduced.removeEventListener("change", sync);
    };
  }, []);

  return { root, rig };
}
