"use client";

import { useEffect, useRef, useState, type JSX, type Ref, type RefObject } from "react";
import { ArrowDown, Check, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export type PullToRefreshPhase = "idle" | "pulling" | "armed" | "refreshing" | "settling";

type PullToRefreshOptions = {
  scrollRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  threshold?: number;
  maxPull?: number;
};

type Gesture = { x: number; y: number; identifier: number; locked: boolean };

function blockedTarget(target: EventTarget | null, owner: HTMLElement): boolean {
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  if (!element || !owner.contains(element)) return true;
  if (element.closest("input, textarea, select, [contenteditable], [data-pull-to-refresh-ignore], [aria-modal='true'], dialog[open]")) return true;

  for (let node = element.parentElement; node && node !== owner; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    if (/^(auto|scroll|overlay)$/.test(style.overflowY) && node.scrollHeight > node.clientHeight && node.scrollTop > 0) return true;
  }
  return false;
}

export function usePullToRefresh({ scrollRef, contentRef, enabled, refreshing, onRefresh, threshold = 68, maxPull = 120 }: PullToRefreshOptions): { phase: PullToRefreshPhase; indicatorRef: RefObject<HTMLDivElement | null> } {
  const indicatorRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<PullToRefreshPhase>("idle");
  const phaseRef = useRef<PullToRefreshPhase>("idle");
  const callbackRef = useRef(onRefresh);
  const refreshingRef = useRef(refreshing);
  const thresholdRef = useRef(threshold);
  const maxPullRef = useRef(maxPull);
  const wasRefreshingRef = useRef(false);
  const transitionsRef = useRef<{ hold: () => void; settle: () => void } | null>(null);

  useEffect(() => {
    callbackRef.current = onRefresh;
    refreshingRef.current = refreshing;
    thresholdRef.current = threshold;
    maxPullRef.current = maxPull;
  });

  useEffect(() => {
    const scroll = scrollRef.current;
    const content = contentRef.current;
    const indicator = indicatorRef.current;
    let gesture: Gesture | null = null;
    let frame: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let endListener: ((event: TransitionEvent) => void) | null = null;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = media.matches;
    const updateMotion = () => { reduced = media.matches; };
    media.addEventListener("change", updateMotion);

    const changePhase = (next: PullToRefreshPhase) => {
      if (phaseRef.current === next) return;
      phaseRef.current = next;
      setPhase(next);
    };
    const clearPending = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (endListener && content) content.removeEventListener("transitionend", endListener);
      endListener = null;
    };
    const paint = (offset: number, next: PullToRefreshPhase, animate: boolean) => {
      clearPending();
      const duration = animate && !reduced ? "220ms" : "0ms";
      if (content) content.style.transition = `transform ${duration} cubic-bezier(0.22, 1, 0.36, 1)`;
      if (indicator) indicator.style.transition = `opacity ${animate ? "220ms" : "0ms"} cubic-bezier(0.22, 1, 0.36, 1), scale ${duration} cubic-bezier(0.22, 1, 0.36, 1)`;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        if (content) content.style.transform = reduced ? "" : `translate3d(0, ${offset}px, 0)`;
        if (indicator) {
          indicator.style.opacity = next === "idle" || next === "settling" ? "0" : next === "pulling" ? String(Math.max(0.2, Math.min(1, offset / thresholdRef.current))) : "1";
          indicator.style.scale = reduced ? "" : next === "pulling" ? String(0.8 + Math.min(0.2, offset / thresholdRef.current * 0.2)) : "1";
          indicator.style.rotate = reduced ? "" : next === "armed" ? "180deg" : "0deg";
        }
      });
    };
    const settle = () => {
      gesture = null;
      changePhase("settling");
      paint(0, "settling", true);
      const finish = () => {
        clearPending();
        if (phaseRef.current !== "settling") return;
        changePhase("idle");
        paint(0, "idle", false);
      };
      endListener = (event) => {
        if (event.target === content && event.propertyName === "transform") finish();
      };
      content?.addEventListener("transitionend", endListener);
      timer = setTimeout(finish, reduced ? 0 : 260);
    };
    const hold = () => {
      if (phaseRef.current === "refreshing") return;
      gesture = null;
      changePhase("refreshing");
      paint(38, "refreshing", true);
    };
    const reset = () => {
      clearPending();
      gesture = null;
      changePhase("idle");
      for (const element of [content, indicator]) {
        if (element) {
          element.style.removeProperty("transform");
          element.style.removeProperty("transition");
          element.style.removeProperty("opacity");
          element.style.removeProperty("scale");
          element.style.removeProperty("rotate");
        }
      }
    };

    transitionsRef.current = { hold, settle };

    const abandon = () => {
      gesture = null;
      if (phaseRef.current === "pulling" || phaseRef.current === "armed") settle();
    };
    const start = (event: TouchEvent) => {
      if (gesture && event.touches.length !== 1) { abandon(); return; }
      if (event.touches.length !== 1 || refreshingRef.current || phaseRef.current !== "idle" || scroll!.scrollTop > 0 ||
          (window.visualViewport?.scale ?? 1) > 1.01 || window.getSelection()?.isCollapsed === false || blockedTarget(event.target, scroll!)) return;
      const touch = event.touches[0];
      gesture = { x: touch.clientX, y: touch.clientY, identifier: touch.identifier, locked: false };
    };
    const move = (event: TouchEvent) => {
      if (!gesture) return;
      if (event.touches.length !== 1 || scroll!.scrollTop > 0 || refreshingRef.current) { abandon(); return; }
      const touch = event.touches[0];
      if (touch.identifier !== gesture.identifier) { abandon(); return; }
      const dx = touch.clientX - gesture.x;
      const dy = touch.clientY - gesture.y;
      if (!gesture.locked) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) <= 8) return;
        if (dy <= 0 || Math.abs(dx) >= dy) { abandon(); return; }
        gesture.locked = true;
      }
      if (dy <= 0) { abandon(); return; }
      event.preventDefault();
      const maxDistance = maxPullRef.current;
      const distance = maxDistance * (1 - 1 / (dy / maxDistance * 0.55 + 1));
      const next = distance >= thresholdRef.current ? "armed" : "pulling";
      changePhase(next);
      paint(distance, next, false);
    };
    const end = (event: TouchEvent) => {
      if (!gesture) return;
      if (event.type === "touchcancel" || event.changedTouches.length !== 1 || event.changedTouches[0].identifier !== gesture.identifier || event.touches.length > 0) { abandon(); return; }
      gesture = null;
      if (phaseRef.current === "armed") {
        hold();
        callbackRef.current();
      } else if (phaseRef.current === "pulling") settle();
    };
    if (enabled && scroll) {
      scroll.addEventListener("touchstart", start, { passive: true });
      scroll.addEventListener("touchmove", move, { passive: false });
      scroll.addEventListener("touchend", end, { passive: true });
      scroll.addEventListener("touchcancel", end, { passive: true });
    }
    return () => {
      if (scroll) {
        scroll.removeEventListener("touchstart", start);
        scroll.removeEventListener("touchmove", move);
        scroll.removeEventListener("touchend", end);
        scroll.removeEventListener("touchcancel", end);
      }
      media.removeEventListener("change", updateMotion);
      transitionsRef.current = null;
      reset();
    };
  }, [scrollRef, contentRef, enabled]);

  useEffect(() => {
    if (enabled && transitionsRef.current) {
      if (refreshing && (!wasRefreshingRef.current || phaseRef.current !== "refreshing")) transitionsRef.current.hold();
      else if (!refreshing && wasRefreshingRef.current) transitionsRef.current.settle();
    }
    wasRefreshingRef.current = refreshing;
  }, [enabled, refreshing]);

  return { phase, indicatorRef };
}

export function PullToRefreshAction({ label, refreshing, onRefresh }: { label: string; refreshing: boolean; onRefresh: () => void }): JSX.Element {
  return <Button
    type="button"
    size="sm"
    variant="outline"
    className="pointer-events-none absolute top-1 left-1/2 z-20 -translate-x-1/2 opacity-0 focus-visible:pointer-events-auto focus-visible:opacity-100"
    loading={refreshing}
    onClick={onRefresh}
  >{label}</Button>;
}

export function PullToRefreshIndicator({ phase, indicatorRef }: { phase: PullToRefreshPhase; indicatorRef?: Ref<HTMLDivElement> }): JSX.Element {
  return (
    <div
      ref={indicatorRef}
      aria-hidden="true"
      data-slot="pull-to-refresh-indicator"
      className={cn("pointer-events-none absolute inset-x-0 top-1 z-10 mx-auto flex size-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-xs motion-reduce:transition-opacity", phase === "idle" || phase === "settling" ? "opacity-0" : "opacity-100")}
    >
      {phase === "refreshing" ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> :
        phase === "armed" ? <><ArrowDown className="size-4 motion-reduce:hidden" /><Check className="hidden size-4 motion-reduce:block" /></> :
          <ArrowDown className="size-4" />}
    </div>
  );
}
