"use client";

import { useEffect, useRef } from "react";

const peerAttribute = "data-breakpoint-peer";
const fallbackAttribute = "data-breakpoint-fallback";
const desktopQuery = "(min-width: 64rem)";

function peerFor(target: Element | null): HTMLElement | null {
  const peer = target?.closest(`[${peerAttribute}]`);
  return peer instanceof HTMLElement ? peer : null;
}

function focusableFor(peer: HTMLElement): HTMLElement | null {
  if (peer.matches("button, a, [tabindex]")) return peer;
  return peer.querySelector<HTMLElement>("button, a[href]");
}

export function useBreakpointFocusHandoff() {
  const lastPeer = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const media = window.matchMedia(desktopQuery);
    lastPeer.current = peerFor(document.activeElement);
    let focusedOnDesktop = media.matches;
    const onFocusIn = (event: FocusEvent) => {
      lastPeer.current = event.target instanceof Element ? peerFor(event.target) : null;
      focusedOnDesktop = media.matches;
    };
    const onFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget !== null || !(event.target instanceof HTMLElement)) return;
      if (event.target.getClientRects().length > 0) {
        lastPeer.current = null;
        return;
      }
      if (lastPeer.current && media.matches !== focusedOnDesktop) {
        queueMicrotask(() => {
          if (document.activeElement === document.body || document.activeElement === null) handOff();
        });
      }
    };
    const handOff = () => {
      const active = document.activeElement;
      const peer = active === document.body
        ? lastPeer.current
        : active instanceof Element ? peerFor(active) : null;
      if (!peer || !peer.isConnected) return;
      const focused = focusableFor(peer);
      if (!focused || focused.getClientRects().length > 0) return;

      const keys = [
        peer.getAttribute(peerAttribute),
        ...(peer.getAttribute(fallbackAttribute)?.split(" ") ?? []),
      ];
      for (const key of keys) {
        for (const candidate of document.querySelectorAll<HTMLElement>(`[${peerAttribute}]`)) {
          if (candidate === peer || candidate.getAttribute(peerAttribute) !== key) continue;
          const target = focusableFor(candidate);
          if (target && target.getClientRects().length > 0 && !target.matches(":disabled") && !target.closest("[hidden], [inert]")) {
            target.focus({ preventScroll: true });
            return;
          }
        }
      }
    };

    const onChange = () => handOff();

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    media.addEventListener("change", onChange);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      media.removeEventListener("change", onChange);
    };
  }, []);
}
