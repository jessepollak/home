import { useEffect, useRef, type RefObject } from "react";
import type { Camera } from "./camera";

export function canvasClipPath(rect: Pick<DOMRect, "top" | "right" | "bottom" | "left">,
  viewport: { width: number; height: number }): string {
  const top = Math.max(0, Math.min(viewport.height, rect.top));
  const right = Math.max(0, Math.min(viewport.width, viewport.width - rect.right));
  const bottom = Math.max(0, Math.min(viewport.height, viewport.height - rect.bottom));
  const left = Math.max(0, Math.min(viewport.width, rect.left));
  return `inset(${top}px ${right}px ${bottom}px ${left}px)`;
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
      if (host) host.style.clipPath = canvasClipPath(canvas.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight });
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
