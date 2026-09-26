"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import styles from "./borrow-illustration.module.css";

export type BorrowIllustrationOption = "keep" | "counterweight" | "tether";

type Timing = CSSProperties & Record<`--${string}`, string>;

function at(delay: number, duration: number, extra: Record<`--${string}`, string> = {}): Timing {
  return { "--delay": `${delay}ms`, "--duration": `${duration}ms`, ...extra };
}

function Draw({ d, delay, duration, stroke = "var(--foreground)", part }: { d: string; delay: number; duration: number; stroke?: string; part?: string }) {
  return (
    <path data-part={part ?? "line"} className={styles.draw} style={at(delay, duration)} d={d} pathLength={1} strokeDasharray="1 2"
      fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  );
}

function Sparkle({ x, y, arm, delay }: { x: number; y: number; arm: number; delay: number }) {
  return (
    <path data-part="accent" className={styles.fade} style={at(delay, 160)} d={`M${x - arm} ${y} H${x + arm} M${x} ${y - arm} V${y + arm}`}
      fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" />
  );
}

function Ground({ cx, cy, rx }: { cx: number; cy: number; rx: number }) {
  return <ellipse data-part="ground" className={styles.fade} style={at(0, 160)} cx={cx} cy={cy} rx={rx} ry="4" fill="var(--muted)" />;
}

function CoinStack({ cx, top, rx, ry, coins, start }: { cx: number; top: number; rx: number; ry: number; coins: number; start: number }) {
  const left = cx - rx;
  const right = cx + rx;
  const bottom = top + coins * 12;
  const dividers = Array.from({ length: coins - 1 }, (_, index) => `M${left} ${top + (index + 1) * 12} A${rx} ${ry} 0 0 0 ${right} ${top + (index + 1) * 12}`).join(" ");
  return (
    <g data-part="collateral">
      <path data-part="fill" className={styles.fade} style={at(start, 160)} d={`M${left} ${top} A${rx} ${ry} 0 0 1 ${right} ${top} V${bottom} A${rx} ${ry} 0 0 1 ${left} ${bottom} Z`} fill="var(--card)" />
      <Draw d={`M${left} ${top} V${bottom} A${rx} ${ry} 0 0 0 ${right} ${bottom} V${top}`} delay={start} duration={260} />
      <Draw d={`M${left} ${top} A${rx} ${ry} 0 0 1 ${right} ${top} A${rx} ${ry} 0 0 1 ${left} ${top}`} delay={start + 80} duration={220} />
      <Draw d={`M${cx - rx * 0.6} ${top} A${rx * 0.6} ${ry * 0.55} 0 0 1 ${cx + rx * 0.6} ${top} A${rx * 0.6} ${ry * 0.55} 0 0 1 ${cx - rx * 0.6} ${top}`} delay={start + 300} duration={120} />
      {coins > 1 ? <Draw d={dividers} delay={start + 260} duration={140} /> : null}
    </g>
  );
}

function Keep() {
  return (
    <>
      <Ground cx={124} cy={138} rx={68} />
      <g data-part="loan" className={styles.enter} style={at(520, 380, { "--x": "-22px" })}>
        <g transform="rotate(-8 144 81)">
          <rect x="96" y="52" width="96" height="58" rx="7" fill="var(--primary)" />
          <Draw d="M164 70 A8 8 0 1 1 180 70 A8 8 0 1 1 164 70" delay={840} duration={160} stroke="var(--primary-foreground)" />
          <Draw d="M146 94 H180" delay={880} duration={120} stroke="var(--primary-foreground)" />
        </g>
      </g>
      <CoinStack cx={88} top={90} rx={30} ry={8} coins={3} start={120} />
      <Sparkle x={206} y={32} arm={6} delay={1000} />
    </>
  );
}

function Counterweight() {
  return (
    <>
      <Ground cx={120} cy={136} rx={54} />
      <path data-part="fill" className={styles.fade} style={at(100, 160)} d="M120 108 L137 132 H103 Z" fill="var(--card)" />
      <Draw d="M120 108 L137 132 H103 Z" delay={100} duration={200} />
      <g data-part="beam" className={styles.tilt} style={{ ...at(800, 440, { "--tilt": "-6deg" }), transform: "rotate(-6deg)" }}>
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
      <Sparkle x={204} y={62} arm={5} delay={1100} />
    </>
  );
}

function Tether() {
  return (
    <>
      <Ground cx={84} cy={136} rx={42} />
      <CoinStack cx={80} top={100} rx={26} ry={7} coins={2} start={80} />
      <g data-part="loan" className={styles.enter} style={at(400, 400, { "--y": "18px" })}>
        <g transform="rotate(8 168 56)">
          <rect x="140" y="28" width="56" height="56" rx="9" fill="var(--primary)" />
          <circle cx="168" cy="56" r="10" fill="none" stroke="var(--primary-foreground)" strokeWidth="2" />
        </g>
      </g>
      <circle data-part="knot" className={styles.fade} style={at(760, 120)} cx="80" cy="100" r="2.5" fill="var(--foreground)" />
      <Draw part="tether" d="M80 100 C80 76 128 104 164 84" delay={760} duration={320} />
      <Sparkle x={206} y={28} arm={6} delay={1040} />
      <Sparkle x={124} y={36} arm={4} delay={1080} />
    </>
  );
}

const art: Record<BorrowIllustrationOption, () => ReactNode> = { keep: Keep, counterweight: Counterweight, tether: Tether };

export function BorrowIllustration({ option, motion = "system", className }: { option: BorrowIllustrationOption; motion?: "system" | "reduce"; className?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [visible, setVisible] = useState(false);
  const [armed, setArmed] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let inView = false;
    const start = () => { if (inView && document.visibilityState === "visible") setVisible(true); };
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting && entry.intersectionRatio >= 0.5;
      start();
    }, { threshold: 0.5 });
    observer.observe(element);
    document.addEventListener("visibilitychange", start);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", start);
    };
  }, []);
  useEffect(() => {
    if (!visible || reduced || motion === "reduce") return;
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setArmed(true)); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [visible, reduced, motion]);
  const Art = art[option];
  const state = reduced || motion === "reduce" ? "idle" : armed ? "playing" : "ready";
  return (
    <svg ref={ref} viewBox="0 0 240 160" aria-hidden="true" focusable="false" data-slot="borrow-illustration" data-option={option} data-state={state}
      data-motion={motion === "reduce" ? "reduce" : undefined} className={className ? `${styles.root} ${className}` : styles.root}>
      <Art />
    </svg>
  );
}
