import { useEffect, useRef, type RefObject } from "react";
import type { Camera } from "./camera";

type Box = Pick<DOMRect, "top" | "right" | "bottom" | "left">;

export function canvasClipPath(rect: Box, host: Box): string | null {
  const width = host.right - host.left;
  const height = host.bottom - host.top;
  if (width <= 0 || height <= 0) return null;
  const inset = (value: number, size: number) => Math.max(0, Math.min(size, value));
  return `inset(${inset(rect.top - host.top, height)}px ${inset(host.right - rect.right, width)}px ${
    inset(host.bottom - rect.bottom, height)}px ${inset(rect.left - host.left, width)}px)`;
}

export function frameThrottle(callback: () => void, requestFrame: (callback: FrameRequestCallback) => number,
  cancelFrame: (handle: number) => void) {
  let pending: number | undefined;
  return {
    schedule() {
      if (pending !== undefined) return;
      pending = requestFrame(() => {
        pending = undefined;
        callback();
      });
    },
    cancel() {
      if (pending !== undefined) cancelFrame(pending);
      pending = undefined;
    },
  };
}

export function useVercelCommentsSync({ camera, canvasRef, enabled }: {
  camera: Camera;
  canvasRef: RefObject<HTMLDivElement | null>;
  enabled: boolean;
}) {
  const repaint = useRef<ReturnType<typeof frameThrottle> | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const throttle = frameThrottle(() => {
      if (!document.querySelector("vercel-live-feedback")) return;
      window.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("resize"));
    }, requestAnimationFrame, cancelAnimationFrame);
    repaint.current = throttle;
    return () => {
      repaint.current = null;
      throttle.cancel();
    };
  }, [enabled]);
  useEffect(() => {
    if (enabled) repaint.current?.schedule();
  }, [camera, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let host: HTMLElement | null = null;
    let original = "";
    const update = () => {
      const next = document.querySelector<HTMLElement>("vercel-live-feedback");
      if (next !== host) {
        if (host) host.style.clipPath = original;
        host = next;
        original = host?.style.clipPath ?? "";
      }
      if (host) host.style.clipPath = canvasClipPath(canvas.getBoundingClientRect(), host.getBoundingClientRect()) ?? original;
    };
    update();
    const resize = new ResizeObserver(update);
    resize.observe(canvas);
    window.addEventListener("resize", update);
    const mutations = new MutationObserver(update);
    mutations.observe(document.body, { childList: true });
    return () => {
      mutations.disconnect();
      resize.disconnect();
      window.removeEventListener("resize", update);
      if (host) host.style.clipPath = original;
    };
  }, [canvasRef, enabled]);
}
