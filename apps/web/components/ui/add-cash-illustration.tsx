"use client";

import { useEffect, useState, type CSSProperties } from "react";
import styles from "./add-cash-illustration.module.css";

type Timing = CSSProperties & { "--delay": string; "--duration": string };
function at(delay: number, duration: number): Timing {
  return { "--delay": `${delay}ms`, "--duration": `${duration}ms` };
}
function Draw({ d, delay, duration }: { d: string; delay: number; duration: number }) {
  return <path className={styles.draw} style={at(delay, duration)} d={d} pathLength="1" strokeDasharray="1 2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" stroke="var(--foreground)" />;
}

export function AddCashIllustration() {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setArmed(true)); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, []);
  return <svg viewBox="0 0 240 160" aria-hidden="true" focusable="false" data-slot="add-cash-illustration" data-state={armed ? "playing" : "ready"} className={styles.root}>
    <path className={styles.fade} style={at(0, 160)} d="M88 80 C108 53.33 132 53.33 152 80" fill="none" stroke="var(--muted-foreground)" strokeWidth="2" strokeLinecap="round" strokeDasharray="0 7" />
    <Draw delay={432} duration={290} d="M37 54 H83 A3 3 0 0 1 86 57 V103 A3 3 0 0 1 83 106 H37 A3 3 0 0 1 34 103 V57 A3 3 0 0 1 37 54 Z" />
    <Draw delay={754} duration={141} d="M46 70 H74 A1 1 0 0 1 75 71 V89 A1 1 0 0 1 74 90 H46 A1 1 0 0 1 45 89 V71 A1 1 0 0 1 46 70 Z" />
    <Draw delay={927} duration={90} d="M45 76 H75" />
    <g className={styles.plane} style={at(120, 280)}>
      <rect x="153" y="53" width="54" height="54" rx="4" fill="var(--primary)" />
      <path d="M176 72 L184 80 L176 88" fill="none" stroke="var(--primary-foreground)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </g>
    <g className={styles.coin} style={at(1049, 280)}><circle r="8" fill="var(--balance-cash)" /></g>
  </svg>;
}
