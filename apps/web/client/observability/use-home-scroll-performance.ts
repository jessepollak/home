import { useEffect, type RefObject } from "react";
import type { HomeInteractionRoute, HomePanelCacheState } from "@/shared/observability/client-performance.contract";
import { discardHomeScroll, noteHomeScroll, noteHomeScrollIntent } from "./interaction-performance";

const scrollKeys = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

export function useHomeScrollPerformance(
  scrollRef: RefObject<HTMLElement | null>, route: HomeInteractionRoute, cache: HomePanelCacheState,
): void {
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const intent = () => noteHomeScrollIntent();
    const keydown = (event: KeyboardEvent) => {
      if (scrollKeys.has(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey &&
        !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement) &&
        !(event.target instanceof HTMLElement && event.target.isContentEditable)) intent();
    };
    const scroll = () => noteHomeScroll({ route, cache });
    element.addEventListener("scroll", scroll, { passive: true });
    element.addEventListener("wheel", intent, { passive: true });
    element.addEventListener("touchmove", intent, { passive: true });
    element.addEventListener("keydown", keydown, { passive: true });
    return () => {
      element.removeEventListener("scroll", scroll);
      element.removeEventListener("wheel", intent);
      element.removeEventListener("touchmove", intent);
      element.removeEventListener("keydown", keydown);
      discardHomeScroll();
    };
  }, [scrollRef, route, cache]);
}
