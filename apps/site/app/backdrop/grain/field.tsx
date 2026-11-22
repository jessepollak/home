"use client";

import { useEffect, useRef } from "react";
import type { BackdropRegion } from "../backdrop";
import styles from "./grain.module.css";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const PLAYING = "data-demo-playing";

function useAmbient(region: BackdropRegion) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = ref.current;
    const root = layer?.parentElement;
    if (!layer || !root) return;
    const query = window.matchMedia(REDUCED_MOTION);
    let inView = false;

    const sync = () => {
      const on = inView && !document.hidden && !query.matches;
      if (on) layer.dataset.motion = "";
      else delete layer.dataset.motion;
    };

    const intersection = new IntersectionObserver(([entry]) => {
      inView = entry?.isIntersecting ?? false;
      sync();
    });
    intersection.observe(root);
    document.addEventListener("visibilitychange", sync);
    query.addEventListener("change", sync);

    let mutation: MutationObserver | undefined;
    if (region === "demo") {
      const light = () => {
        if (root.querySelector(`[${PLAYING}]`)) layer.dataset.lit = "";
        else delete layer.dataset.lit;
      };
      light();
      mutation = new MutationObserver(light);
      mutation.observe(root, { subtree: true, attributes: true, attributeFilter: [PLAYING] });
    }

    return () => {
      intersection.disconnect();
      mutation?.disconnect();
      document.removeEventListener("visibilitychange", sync);
      query.removeEventListener("change", sync);
    };
  }, [region]);

  return ref;
}

export function GrainField({ region }: { region: BackdropRegion }) {
  const ref = useAmbient(region);

  if (region === "demo") {
    return (
      <div ref={ref} aria-hidden="true" className={styles.layer}>
        <div className={styles.patch}>
          <div className={styles.paper} />
          <div className={styles.tint} />
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} aria-hidden="true" className={styles.layer}>
      {region !== "customers" && (
        <div className={styles.field}>
          <div className={`${styles.light} ${styles.one}`} />
          <div className={`${styles.light} ${styles.two}`} />
          <div className={`${styles.light} ${styles.three}`} />
        </div>
      )}
      <div className={styles.grain} />
    </div>
  );
}
