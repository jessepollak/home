"use client";

import { useEffect, useSyncExternalStore } from "react";

type VisualViewportGeometry = { height: number; offsetTop: number; scale: number };

function visualViewportShrunk(innerHeight: number, viewport: VisualViewportGeometry): boolean {
  return viewport.scale <= 1.01 && innerHeight - viewport.height > 60;
}

export function visualViewportKeyboardInset(innerHeight: number, viewport: VisualViewportGeometry): number {
  return visualViewportShrunk(innerHeight, viewport)
    ? Math.max(0, Math.ceil(innerHeight - Math.min(innerHeight, Math.max(0, viewport.offsetTop) + viewport.height)))
    : 0;
}

export function visualViewportKeyboardFrame(
  innerHeight: number,
  viewport: VisualViewportGeometry,
): { top: number; inset: number } {
  if (!visualViewportShrunk(innerHeight, viewport)) return { top: 0, inset: 0 };
  const inset = visualViewportKeyboardInset(innerHeight, viewport);
  return { inset, top: Math.min(innerHeight - inset, Math.max(0, Math.floor(viewport.offsetTop))) };
}

export function shellViewportBottomInset(layoutViewportHeight: number, viewport?: VisualViewportGeometry | null, editable = false): number {
  return !editable || !viewport || viewport.scale > 1.01 ? 0 : Math.max(0, layoutViewportHeight - (viewport.offsetTop + viewport.height));
}

const keyboardListeners = new Set<() => void>();
let references = 0;
let keyboardOpen = false;
let stop: (() => void) | undefined;
let scheduleGeometry: (() => void) | undefined;
const viewportTargets = "[data-shell-viewport], [data-asset-search-bar], [data-asset-search-scroll], [data-slot='toast-viewport']";
const viewportProperties = ["--shell-viewport-inset-bottom", "--shell-viewport-keyboard-height", "--shell-viewport-pan"] as const;

function retainGeometry() {
  references += 1;
  if (references === 1) {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    let frame: number | undefined;
    const update = () => {
      frame = undefined;
      const height = window.innerHeight;
      const geometry = viewport ? { height: viewport.height, offsetTop: viewport.offsetTop, scale: viewport.scale } : null;
      const target = document.activeElement;
      const editable = target instanceof HTMLElement &&
        (target.matches("input, textarea, select, [contenteditable]:not([contenteditable='false'])") || target.isContentEditable);
      const tracking = editable || !!document.querySelector("[data-shell-search-viewport]");
      const inset = shellViewportBottomInset(height, geometry, tracking);
      const keyboardHeight = tracking && geometry && geometry.scale <= 1.01 ? Math.max(0, height - geometry.height) : 0;
      const pan = keyboardHeight - inset;
      const values = [`${inset}px`, `${keyboardHeight}px`, `${pan}px`];
      for (const element of document.querySelectorAll<HTMLElement>(viewportTargets)) {
        viewportProperties.forEach((property, index) => {
          if (element.style.getPropertyValue(property) !== values[index]) element.style.setProperty(property, values[index]);
        });
      }
      const nextKeyboardOpen = !!editable && !!geometry && visualViewportKeyboardInset(height, geometry) > 0;
      if (nextKeyboardOpen !== keyboardOpen) {
        keyboardOpen = nextKeyboardOpen;
        if (keyboardOpen) root.dataset.shellKeyboard = "open";
        else delete root.dataset.shellKeyboard;
        for (const listener of keyboardListeners) listener();
      }
    };
    const schedule = () => {
      if (frame === undefined) frame = requestAnimationFrame(update);
    };
    scheduleGeometry = schedule;
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    schedule();
    stop = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
      for (const element of document.querySelectorAll<HTMLElement>(viewportTargets)) {
        for (const property of viewportProperties) element.style.removeProperty(property);
      }
      delete root.dataset.shellKeyboard;
      keyboardOpen = false;
    };
  } else scheduleGeometry?.();
  return () => {
    references -= 1;
    if (references === 0) {
      stop?.();
      stop = undefined;
      scheduleGeometry = undefined;
    } else scheduleGeometry?.();
  };
}

function subscribeKeyboard(listener: () => void) {
  keyboardListeners.add(listener);
  const release = retainGeometry();
  return () => {
    keyboardListeners.delete(listener);
    release();
  };
}

export function useShellViewportGeometry(enabled = true): void {
  useEffect(() => enabled ? retainGeometry() : undefined, [enabled]);
}

function subscribeInactive() {
  return () => {};
}

export function useShellKeyboardOpen(enabled = true): boolean {
  return useSyncExternalStore(enabled ? subscribeKeyboard : subscribeInactive, () => enabled && keyboardOpen, () => false);
}
