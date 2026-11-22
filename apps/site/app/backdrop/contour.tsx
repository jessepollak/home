"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import type { BackdropProps } from "./backdrop";
import styles from "./contour/contour.module.css";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const EMPHASIZED = "cubic-bezier(.2, 0, 0, 1)";
const RINGS = [
  { offset: 12, alpha: 0.9 },
  { offset: 28, alpha: 0.6 },
  { offset: 46, alpha: 0.36 },
  { offset: 66, alpha: 0.18 },
] as const;

const reduced = () => window.matchMedia(REDUCED_MOTION).matches;

function useTravel() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const layer = ref.current;
    if (!layer) return;
    const query = window.matchMedia(REDUCED_MOTION);
    let inView = false;
    const sync = () => {
      if (query.matches) {
        delete layer.dataset.motion;
        delete layer.dataset.paused;
        return;
      }
      if (inView && !document.hidden) {
        layer.dataset.motion = "";
        delete layer.dataset.paused;
      } else if (layer.dataset.motion !== undefined) {
        layer.dataset.paused = "";
      }
    };
    const observer = new IntersectionObserver(([entry]) => {
      inView = Boolean(entry?.isIntersecting);
      sync();
    });
    observer.observe(layer);
    query.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      observer.disconnect();
      query.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);
  return ref;
}

function useContours() {
  const wrapper = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = wrapper.current;
    const box = field.current;
    const demo = root?.querySelector<HTMLElement>("[data-demo]");
    if (!root || !box || !demo) return;
    const rings = Array.from(box.querySelectorAll<HTMLElement>("[data-ring]"));
    const pulse = box.querySelector<HTMLElement>("[data-pulse]");

    const place = () => {
      const outer = root.getBoundingClientRect();
      const inner = demo.getBoundingClientRect();
      box.style.left = `${inner.left - outer.left}px`;
      box.style.top = `${inner.top - outer.top}px`;
      box.style.width = `${inner.width}px`;
      box.style.height = `${inner.height}px`;
      box.dataset.measured = "";
    };
    const resize = new ResizeObserver(place);
    resize.observe(root);
    resize.observe(demo);

    let step = demo.dataset.demoStep;
    const ripple = () => {
      if (reduced() || document.hidden) return;
      rings.forEach((ring, index) => {
        const rest = getComputedStyle(ring).opacity;
        ring.animate(
          [
            { opacity: rest, transform: "scale(1)" },
            { opacity: 1, transform: "scale(1.012)", offset: 0.25 },
            { opacity: rest, transform: "scale(1)" },
          ],
          { duration: 1000, delay: 60 + index * 90, easing: EMPHASIZED },
        );
      });
      const reach = window.matchMedia("(min-width: 48rem)").matches ? 120 : 56;
      const grow = `scale(${1 + reach / box.offsetWidth}, ${1 + reach / box.offsetHeight})`;
      pulse?.animate(
        [{ opacity: 0.9, transform: "scale(1)" }, { opacity: 0, transform: grow }],
        { duration: 1100, easing: EMPHASIZED },
      );
    };
    const mutations = new MutationObserver(() => {
      if (demo.dataset.demoPlaying !== undefined) box.dataset.live = "";
      else delete box.dataset.live;
      const next = demo.dataset.demoStep;
      if (next === step) return;
      const started = step !== undefined && Number(next) > Number(step);
      step = next;
      if (started) ripple();
    });
    mutations.observe(demo, { attributes: true, attributeFilter: ["data-demo-step", "data-demo-playing"] });

    return () => {
      resize.disconnect();
      mutations.disconnect();
      box.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
    };
  }, []);
  return { wrapper, field };
}

function DemoContours({ children }: Pick<BackdropProps, "children">) {
  const { wrapper, field } = useContours();
  return (
    <div ref={wrapper} className={styles.demo}>
      <div ref={field} aria-hidden="true" className={styles.field}>
        {RINGS.map(({ offset, alpha }) => (
          <svg key={offset} data-ring="" className={styles.ring} style={{ "--o": `${offset}px`, "--a": alpha } as CSSProperties}>
            <rect width="100%" height="100%" />
          </svg>
        ))}
        <div data-pulse="" className={styles.pulse} />
      </div>
      {children}
    </div>
  );
}

function HeroGrid({ children }: Pick<BackdropProps, "children">) {
  const layer = useTravel();
  return (
    <div className={styles.region}>
      <div ref={layer} aria-hidden="true" className={`${styles.layer} ${styles.hero}`}>
        <div className={styles.dots} />
        <div className={styles.band}>
          <div className={`${styles.dots} ${styles.bandDots}`} />
        </div>
      </div>
      {children}
    </div>
  );
}

export function ContourBackdrop({ region, children }: BackdropProps) {
  if (region === "demo") return <DemoContours>{children}</DemoContours>;
  if (region === "hero") return <HeroGrid>{children}</HeroGrid>;
  return (
    <div data-contour={region} className={`${styles.region} ${styles.clip}`}>
      <div aria-hidden="true" className={`${styles.layer} ${region === "team" ? "" : styles.customers}`}>
        <div className={region === "team" ? styles.team : styles.dots} />
      </div>
      {children}
    </div>
  );
}
