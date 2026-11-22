"use client";

import { useEffect, useRef } from "react";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

export function useDepth<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const query = window.matchMedia(REDUCED_MOTION);
    let inView = false;

    const syncActive = () => {
      const active = inView && !query.matches && document.visibilityState === "visible";
      root.toggleAttribute("data-depth-active", active);
    };
    const syncMotion = () => {
      root.toggleAttribute("data-depth-motion", !query.matches);
      syncActive();
    };

    const observer = new IntersectionObserver(([entry]) => {
      inView = entry?.isIntersecting ?? false;
      syncActive();
    });
    observer.observe(root);

    const demo = root.querySelector("[data-demo]");
    const mirror = new MutationObserver(() => root.toggleAttribute("data-depth-lift", demo?.hasAttribute("data-demo-playing") ?? false));
    if (demo) mirror.observe(demo, { attributes: true, attributeFilter: ["data-demo-playing"] });

    syncMotion();
    query.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncActive);
    return () => {
      observer.disconnect();
      mirror.disconnect();
      query.removeEventListener("change", syncMotion);
      document.removeEventListener("visibilitychange", syncActive);
      root.removeAttribute("data-depth-motion");
      root.removeAttribute("data-depth-active");
      root.removeAttribute("data-depth-lift");
    };
  }, []);

  return ref;
}
