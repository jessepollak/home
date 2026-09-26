"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import styles from "./borrow-illustration.module.css";

type Timing = CSSProperties & Record<`--${string}`, string>;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function at(delay: number, duration: number, extra: Record<`--${string}`, string> = {}): Timing {
  return { "--delay": `${delay}ms`, "--duration": `${duration}ms`, ...extra };
}

function Draw({ d, delay, duration }: { d: string; delay: number; duration: number }) {
  return (
    <path data-part="line" className={styles.draw} style={at(delay, duration)} d={d} pathLength={1} strokeDasharray="1 2"
      fill="none" stroke="var(--foreground)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  );
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

function useSeenOnce(ref: RefObject<Element | null>) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || seen) return;
    let inView = typeof IntersectionObserver === "undefined";
    const start = () => { if (inView && document.visibilityState === "visible") setSeen(true); };
    document.addEventListener("visibilitychange", start);
    const observer = inView ? null : new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting && entry.intersectionRatio >= 0.5;
      start();
    }, { threshold: 0.5 });
    observer?.observe(element);
    start();
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", start);
    };
  }, [ref, seen]);
  return seen;
}

export function BorrowIllustration() {
  const ref = useRef<SVGSVGElement>(null);
  const reduced = usePrefersReducedMotion();
  const seen = useSeenOnce(ref);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!seen || reduced) return;
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setArmed(true)); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [seen, reduced]);
  const [settled, setSettled] = useState(false);
  if (reduced && armed && !settled) setSettled(true);
  const state = reduced || settled ? "idle" : armed ? "playing" : "ready";
  return (
    <svg ref={ref} viewBox="0 0 240 160" aria-hidden="true" focusable="false" data-slot="borrow-illustration" data-state={state} className={styles.root}>
      <ellipse data-part="ground" className={styles.fade} style={at(0, 160)} cx="120" cy="136" rx="54" ry="4" fill="var(--muted)" />
      <path data-part="fill" className={styles.fade} style={at(100, 160)} d="M120 108 L137 132 H103 Z" fill="var(--card)" />
      <Draw d="M120 108 L137 132 H103 Z" delay={100} duration={200} />
      <g data-part="beam" className={styles.tilt} style={at(800, 440)}>
        <Draw d="M120 108 H38" delay={300} duration={240} />
        <Draw d="M120 108 H202" delay={300} duration={240} />
        <g data-part="loan" className={styles.enter} style={at(560, 280, { "--y": "-10px" })}>
          <circle cx="180" cy="93" r="14" fill="var(--primary)" />
          <circle cx="180" cy="93" r="6" fill="none" stroke="var(--primary-foreground)" strokeWidth="2" />
        </g>
        <g data-part="collateral" className={styles.enter} style={at(640, 300, { "--y": "-16px" })}>
          <circle cx="66" cy="83" r="24" fill="var(--card)" stroke="var(--foreground)" strokeWidth="2" />
          <circle cx="66" cy="83" r="15" fill="none" stroke="var(--foreground)" strokeWidth="2" />
        </g>
      </g>
      <path data-part="accent" className={styles.fade} style={at(1100, 160)} d="M199 62 H209 M204 57 V67"
        fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
