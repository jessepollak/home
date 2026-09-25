import { useEffect, useId, useState } from "react";
import styles from "./illustration.module.css";

type IllustrationProps = {
  direction: "a" | "b" | "c";
  subject: "card" | "savings" | "money";
  variant?: "intro" | "completion";
  play?: boolean;
  motion?: "system" | "reduce";
  idle?: "none" | "twinkle";
  className?: string;
};

const shadow = "color-mix(in oklab, var(--foreground) 8%, transparent)";
const faintShadow = "color-mix(in oklab, var(--foreground) 6%, transparent)";

function Sparkle({ x, y, arm, className, style }: { x: number; y: number; arm: number; className?: string; style?: React.CSSProperties }) {
  return (
    <g data-part="accent" className={className} style={style} stroke="var(--primary)" strokeWidth="2" strokeLinecap="round">
      <path d={`M${x - arm} ${y} H${x + arm} M${x} ${y - arm} V${y + arm}`} />
    </g>
  );
}

function SoftBlocks({ subject }: { subject: IllustrationProps["subject"] }) {
  if (subject === "card") return (
    <>
      <ellipse data-part="ground" cx="120" cy="142" rx="52" ry="5" fill="var(--muted)" />
      <g transform="rotate(-8 120 80)">
        <rect x="60" y="44" width="128" height="84" rx="10.4" fill={shadow} />
        <rect data-part="plane" x="56" y="38" width="128" height="84" rx="10.4" fill="var(--primary)" />
        <rect x="72" y="58" width="20" height="15" rx="3.2" fill="var(--primary-foreground)" opacity="0.9" />
      </g>
      <circle data-part="accent" cx="44" cy="40" r="10" fill="var(--balance-cash)" />
      <circle data-part="accent" cx="204" cy="118" r="7" fill="var(--balance-investments)" />
      <circle data-part="accent" cx="206" cy="36" r="5" fill="var(--balance-savings)" />
    </>
  );
  if (subject === "savings") return (
    <>
      <rect data-part="ground" x="44" y="128" width="152" height="6" rx="3" fill="var(--muted)" />
      <rect x="68" y="104" width="28" height="24" rx="5.6" fill="var(--muted-foreground)" />
      <rect x="106" y="84" width="28" height="44" rx="5.6" fill="var(--balance-cash)" />
      <rect x="148" y="66" width="28" height="68" rx="5.6" fill={shadow} />
      <rect data-part="plane" x="144" y="60" width="28" height="68" rx="5.6" fill="var(--balance-savings)" />
      <circle data-part="accent" cx="186" cy="40" r="12" fill="var(--balance-savings)" />
    </>
  );
  return (
    <>
      <path data-part="ground" d="M40 112 C90 40 150 40 200 96" fill="none" stroke="var(--muted)" strokeWidth="14" strokeLinecap="round" />
      <path d="M196 78 L216 108 L179 102 Z" fill="var(--muted)" />
      <circle data-part="coin" cx="74" cy="79" r="9" fill="var(--balance-cash)" />
      <circle data-part="coin" cx="120" cy="58" r="9" fill="var(--primary)" />
      <circle data-part="coin" cx="167" cy="71" r="9" fill="var(--balance-cash)" />
    </>
  );
}

type Step = { part: string; kind: "draw" | "fade" | "plane" | "coin"; length?: number; duration?: number; gesture?: string };

const steps: Record<string, Step[]> = {
  card: [
    { part: "ground", kind: "fade", duration: 160 },
    { part: "plane", kind: "plane", duration: 280 },
    { part: "twin", kind: "draw", length: 239.2 },
    { part: "chip", kind: "draw", length: 68.3 },
    { part: "arc1", kind: "draw", length: 9.4, gesture: "contactless" },
    { part: "arc2", kind: "draw", length: 15.7, gesture: "contactless" },
    { part: "arc3", kind: "draw", length: 22, gesture: "contactless" },
    { part: "accent", kind: "fade", duration: 160 },
  ],
  savings: [
    { part: "ground", kind: "draw", length: 155 },
    { part: "plane", kind: "plane", duration: 280 },
    { part: "col1", kind: "draw", length: 74.8 },
    { part: "col2", kind: "draw", length: 114.8 },
    { part: "curve", kind: "draw", length: 135.8, gesture: "rise" },
    { part: "head", kind: "draw", length: 24, gesture: "rise" },
    { part: "accent", kind: "fade", duration: 160 },
  ],
  money: [
    { part: "ground", kind: "fade", duration: 160 },
    { part: "plane", kind: "plane", duration: 280 },
    { part: "outline", kind: "draw", length: 202.9 },
    { part: "wallet", kind: "draw", length: 98.3 },
    { part: "flap", kind: "draw", length: 30 },
    { part: "coin", kind: "coin", duration: 280 },
  ],
  completion: [
    { part: "context", kind: "fade", duration: 160 },
    { part: "plane", kind: "plane", duration: 240 },
    { part: "check", kind: "draw", length: 37, duration: 220 },
  ],
};

function schedule(subject: string) {
  const result: Record<string, { delay: number; duration: number }> = {};
  let end = 0;
  for (const [index, step] of steps[subject].entries()) {
    const duration = step.duration ?? Math.max(90, Math.ceil((step.length ?? 0) / 0.7));
    const previous = steps[subject][index - 1];
    const delay = index === 0 ? 0 : index === 1 ? end - (subject === "completion" ? 80 : 40) : end + (step.kind === "draw" && previous.kind === "draw" && step.gesture && step.gesture === previous.gesture ? 0 : 32);
    result[step.part] = { delay, duration };
    end = delay + duration;
  }
  return { times: result, total: end };
}

type TimingStyle = React.CSSProperties & { "--delay": string; "--duration": string };

function LinePlane({ subject, variant, idle }: { subject: IllustrationProps["subject"]; variant: IllustrationProps["variant"]; idle: IllustrationProps["idle"] }) {
  const clipId = useId();
  const completion = subject === "money" && variant === "completion";
  const { times } = schedule(completion ? "completion" : subject);
  const timing = (part: string): TimingStyle => ({ "--delay": `${times[part].delay}ms`, "--duration": `${times[part].duration}ms` });
  const draw = (part: string, d: string, color: string) => (
    <path data-part="draw" data-step={part} data-gesture={steps[completion ? "completion" : subject].find((step) => step.part === part)?.gesture ?? part} data-length={steps[completion ? "completion" : subject].find((step) => step.part === part)?.length} className={styles.draw} style={timing(part)} d={d} pathLength="1" strokeDasharray="1 2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" stroke={color} />
  );
  if (subject === "card") return (
    <>
      <ellipse data-part="ground" className={styles.fade} style={timing("ground")} cx="124" cy="138" rx="52" ry="4" fill="var(--muted)" />
      <g transform="rotate(6 129 83)">{draw("twin", "M164 41 H186.8 A6.2 6.2 0 0 1 193 47.2 V118.8 A6.2 6.2 0 0 1 186.8 125 H71.2 A6.2 6.2 0 0 1 65 118.8", "var(--foreground)")}</g>
      <g data-part="plane" className={styles.plane} style={timing("plane")}>
        <g transform="rotate(-8 111 69)">
          <rect x="47" y="27" width="128" height="84" rx="7.2" fill="var(--primary)" />
          {draw("chip", "M66 45 H84 A1 1 0 0 1 85 46 V59 A1 1 0 0 1 84 60 H66 A1 1 0 0 1 65 59 V46 A1 1 0 0 1 66 45 Z", "var(--primary-foreground)")}
          {draw("arc1", "M155.24 48.76 A6 6 0 0 1 155.24 57.24", "var(--primary-foreground)")}
          {draw("arc2", "M158.07 45.93 A10 10 0 0 1 158.07 60.07", "var(--primary-foreground)")}
          {draw("arc3", "M160.9 43.1 A14 14 0 0 1 160.9 62.9", "var(--primary-foreground)")}
        </g>
      </g>
      <Sparkle x={194} y={28} arm={7} className={idle === "twinkle" ? `${styles.accent} ${styles.twinkle}` : styles.accent} style={timing("accent")} />
      <Sparkle x={44} y={136} arm={5} className={idle === "twinkle" ? `${styles.accent} ${styles.twinkle}` : styles.accent} style={timing("accent")} />
    </>
  );
  if (subject === "savings") return (
    <>
      <defs><clipPath id={clipId}><rect x="0" y="0" width="240" height="129" /></clipPath></defs>
      <g clipPath={`url(#${clipId})`}><g data-part="plane" className={styles.plane} style={timing("plane")}><path d="M143 129 V63.4 A2.4 2.4 0 0 1 145.4 61 H170.6 A2.4 2.4 0 0 1 173 63.4 V129 Z" fill="var(--balance-savings)" /></g></g>
      <path data-part="draw" data-step="ground" data-gesture="ground" data-length="155" className={styles.draw} style={timing("ground")} d="M41 129 H196" pathLength="1" strokeDasharray="1 2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" stroke="var(--foreground)" />
      {draw("col1", "M68 129 V106.4 A1.4 1.4 0 0 1 69.4 105 H94.6 A1.4 1.4 0 0 1 96 106.4 V129", "var(--foreground)")}
      {draw("col2", "M106 129 V86.4 A1.4 1.4 0 0 1 107.4 85 H132.6 A1.4 1.4 0 0 1 134 86.4 V129", "var(--foreground)")}
      {draw("curve", "M60 97 Q110 45 178 35", "var(--balance-savings)")}
      {draw("head", "M178 35 L170.9 31.4 L178 35 L172.2 40.5", "var(--balance-savings)")}
      <Sparkle x={194} y={47} arm={6} className={styles.accent} style={timing("accent")} />
    </>
  );
  const arc = <path data-part="ground" className={completion ? undefined : styles.fade} style={completion ? undefined : timing("ground")} d="M88 80 C108 53.33 132 53.33 152 80" fill="none" stroke="var(--muted-foreground)" strokeWidth="2" strokeLinecap="round" strokeDasharray="0 7" />;
  const source = !completion && <>
    {draw("outline", "M37 54 H83 A3 3 0 0 1 86 57 V103 A3 3 0 0 1 83 106 H37 A3 3 0 0 1 34 103 V57 A3 3 0 0 1 37 54 Z", "var(--foreground)")}
    {draw("wallet", "M46 70 H74 A1 1 0 0 1 75 71 V89 A1 1 0 0 1 74 90 H46 A1 1 0 0 1 45 89 V71 A1 1 0 0 1 46 70 Z", "var(--foreground)")}
    {draw("flap", "M45 76 H75", "var(--foreground)")}
  </>;
  return (
    <>
      {completion ? <g data-part="context" className={styles.fade} style={timing("context")}>{arc}<path d="M37 54 H83 A3 3 0 0 1 86 57 V103 A3 3 0 0 1 83 106 H37 A3 3 0 0 1 34 103 V57 A3 3 0 0 1 37 54 Z" fill="none" stroke="var(--foreground)" strokeWidth="2" /><path d="M46 70 H74 A1 1 0 0 1 75 71 V89 A1 1 0 0 1 74 90 H46 A1 1 0 0 1 45 89 V71 A1 1 0 0 1 46 70 Z" fill="none" stroke="var(--foreground)" strokeWidth="2" /><path d="M45 76 H75" fill="none" stroke="var(--foreground)" strokeWidth="2" /></g> : <>{arc}{source}</>}
      <g data-part="plane" className={styles.plane} style={timing("plane")}>
        <rect x="153" y="53" width="54" height="54" rx="4" fill="var(--primary)" />
        {completion ? draw("check", "M167 79.5 L176 88.5 L193 71.5", "var(--primary-foreground)") : <path data-part="chevron" d="M176 72 L184 80 L176 88" fill="none" stroke="var(--primary-foreground)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>}
      </g>
      {!completion && <g data-part="coin" className={styles.coin} style={timing("coin")}><circle r="8" fill="var(--balance-cash)" /></g>}
    </>
  );
}

function FragmentRow({ y, accent }: { y: number; accent: string }) {
  return (
    <g>
      <rect x="48" y={y + 3} width="144" height="32" rx="7.2" fill={faintShadow} />
      <rect x="48" y={y} width="144" height="32" rx="7.2" fill="var(--card)" stroke="var(--border)" />
      <circle cx="66" cy={y + 16} r="7" fill={accent} />
      <rect x="82" y={y + 9} width="62" height="6" rx="3" fill="var(--muted)" />
      <rect x="82" y={y + 19} width="40" height="6" rx="3" fill="var(--muted)" />
    </g>
  );
}

function UiFragments({ subject }: { subject: IllustrationProps["subject"] }) {
  if (subject === "card") return (
    <>
      <path d="M136 72 H158 V92" fill="none" stroke="var(--muted-foreground)" strokeWidth="1" strokeDasharray="3 3" />
      <circle cx="158" cy="92" r="3" fill="var(--primary)" />
      <rect x="40" y="43" width="96" height="60" rx="10.4" fill={faintShadow} />
      <rect data-part="plane" x="40" y="40" width="96" height="60" rx="10.4" fill="var(--primary)" />
      <rect x="52" y="52" width="19" height="14" rx="2.4" fill="var(--primary-foreground)" />
      <rect x="132" y="95" width="84" height="28" rx="7.2" fill={faintShadow} />
      <rect x="132" y="92" width="84" height="28" rx="7.2" fill="var(--card)" stroke="var(--border)" />
      <circle cx="146" cy="106" r="6" fill="var(--primary)" />
      <rect x="158" y="100" width="40" height="6" rx="3" fill="var(--muted)" />
      <rect x="158" y="110" width="26" height="4" rx="2" fill="var(--muted)" />
      <rect x="148" y="40" width="32" height="18" rx="9" fill="var(--primary)" />
      <circle cx="170" cy="49" r="6" fill="var(--primary-foreground)" />
    </>
  );
  if (subject === "savings") return (
    <>
      <rect x="40" y="35" width="160" height="96" rx="7.2" fill={faintShadow} />
      <rect data-part="plane" x="40" y="32" width="160" height="96" rx="7.2" fill="var(--card)" stroke="var(--border)" />
      <rect x="56" y="46" width="58" height="6" rx="3" fill="var(--muted)" />
      <rect x="56" y="56" width="34" height="6" rx="3" fill="var(--muted)" />
      <path data-part="line" d="M56 108 L96 96 L136 80 L184 52" fill="none" stroke="var(--balance-savings)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle data-part="accent" cx="184" cy="52" r="3" fill="var(--primary)" />
    </>
  );
  return (
    <>
      <path d="M120 76 V100" fill="none" stroke="var(--muted-foreground)" strokeWidth="1" strokeDasharray="3 3" />
      <circle cx="120" cy="88" r="4" fill="var(--primary)" />
      <FragmentRow y={44} accent="var(--primary)" />
      <FragmentRow y={100} accent="var(--balance-cash)" />
    </>
  );
}

export function Illustration({ direction, subject, variant = "intro", play, motion = "system", idle = "none", className }: IllustrationProps) {
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
    if (!play || reduced || motion === "reduce") return;
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setArmed(true)); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [play, reduced, motion]);
  const state = direction !== "b" || play === undefined || reduced || motion === "reduce" ? "idle" : armed && play ? "playing" : "ready";
  const { total } = schedule(subject === "money" && variant === "completion" ? "completion" : subject);
  return (
    <svg
      viewBox="0 0 240 160"
      aria-hidden="true"
      focusable="false"
      data-slot="illustration"
      data-direction={direction}
      data-subject={subject}
      data-state={state}
      data-motion={motion === "reduce" ? "reduce" : undefined}
      data-idle={idle === "twinkle" ? "twinkle" : undefined}
      style={{ "--entrance": `${total}ms` } as React.CSSProperties}
      className={className ? `${styles.root} ${className}` : styles.root}
    >
      {direction === "a" ? <SoftBlocks subject={subject} /> : direction === "b" ? <LinePlane subject={subject} variant={variant} idle={idle} /> : <UiFragments subject={subject} />}
    </svg>
  );
}
