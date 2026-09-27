"use client";

import { useEffect, useRef, useState } from "react";
import { TradeActions } from "@/client/trading/trade-actions";
import type { InvestAsset } from "@/config/invest-assets";
import { resolveTradeAsset } from "@/shared/trading/assets";
import { useReducedMotion } from "./asset-chart";

export function PinnedTradeBar({ asset }: { asset: InvestAsset }) {
  const reduced = useReducedMotion();
  const [desktop, setDesktop] = useState(false);
  const [shown, setShown] = useState(true);
  const bar = useRef<HTMLDivElement>(null);
  const status = resolveTradeAsset(asset.id);
  const tradeStatus = status?.status;
  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia("(min-width: 1024px)");
    const sync = () => setDesktop(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (reduced || desktop || !tradeStatus || tradeStatus === "eligibility-required") return;
    const element = bar.current;
    if (!element) return;
    let source: HTMLElement | Window = window;
    for (let node = element.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY)) {
        source = node;
        break;
      }
    }
    let previous = source === window ? window.scrollY : (source as HTMLElement).scrollTop;
    let distance = 0;
    let direction = 0;
    let timer: number | undefined;
    const show = () => { setShown(true); distance = 0; };
    const scroll = () => {
      const top = source === window ? window.scrollY : (source as HTMLElement).scrollTop;
      const height = source === window ? window.innerHeight : (source as HTMLElement).clientHeight;
      const total = source === window ? document.documentElement.scrollHeight : (source as HTMLElement).scrollHeight;
      const delta = top - previous;
      previous = top;
      if (delta && Math.sign(delta) !== direction) { distance = 0; direction = Math.sign(delta); }
      distance += Math.abs(delta);
      if (total - top - height <= 8) show();
      else if (delta < 0 && distance >= 8) show();
      else if (delta > 0 && top > 64 && distance >= 24 && !element.contains(document.activeElement)) {
        setShown(false); distance = 0;
      }
      if (!("onscrollend" in source)) {
        window.clearTimeout(timer);
        timer = window.setTimeout(show, 400);
      }
    };
    source.addEventListener("scroll", scroll, { passive: true });
    source.addEventListener("scrollend", show);
    element.addEventListener("focusin", show);
    return () => {
      source.removeEventListener("scroll", scroll);
      source.removeEventListener("scrollend", show);
      element.removeEventListener("focusin", show);
      window.clearTimeout(timer);
    };
  }, [asset.id, reduced, desktop, tradeStatus]);
  if (!status) return null;
  if (status.status === "eligibility-required") return <TradeActions asset={asset} layout="sticky" />;
  return <div ref={bar} data-state={shown || reduced || desktop ? "shown" : "hidden"}
    className="sticky -bottom-4 z-2 -mx-4 border-t border-border bg-background px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:mx-0 sm:px-0"
    style={{ transform: reduced ? undefined : shown || desktop ? "translateY(0)" : "translateY(100%)",
      pointerEvents: shown || reduced || desktop ? undefined : "none",
      transition: reduced ? "none" : `transform ${shown ? 180 : 160}ms cubic-bezier(${shown ? "0.2,0,0,1" : "0.4,0,0.2,1"})` }}>
    <TradeActions asset={asset} layout="sticky" />
  </div>;
}
