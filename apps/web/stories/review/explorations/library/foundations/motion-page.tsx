import { useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { foundations, type Timing } from "./model";
import { rootProperties } from "./probe";
import { cubicBezier, type MotionUse } from "./usage";
import styles from "./foundations.module.css";

const REDUCED = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const media = matchMedia(REDUCED);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => matchMedia(REDUCED).matches, () => false);
}

type Resolved = { duration: number; durationSource: string; easing: string; easingSource: string };

function useResolver() {
  return useMemo(() => {
    const names = ["default-transition-duration", "default-transition-timing-function", "ease-in", "ease-out", "ease-in-out"];
    const computed = rootProperties(names);
    const defaultDuration = Number.parseFloat(computed["default-transition-duration"]) *
      (computed["default-transition-duration"].endsWith("ms") ? 1 : 1000);
    return (timing: Pick<Timing, "duration" | "easing">): Resolved => {
      const stock = timing.easing ? /^--(ease-[\w-]+)$/.exec(timing.easing) : null;
      return {
        duration: timing.duration ?? defaultDuration,
        durationSource: timing.duration === null ? "Tailwind default" : `duration-${timing.duration}`,
        easing: timing.easing === null ? computed["default-transition-timing-function"]
          : stock ? computed[stock[1]] : timing.easing,
        easingSource: timing.easing === null ? "Tailwind default" : stock ? stock[1] : "arbitrary",
      };
    };
  }, []);
}

function formatEasing(easing: string): string {
  return easing.replace(/\s*,\s*/g, ", ");
}

function Curve({ easing, large }: { easing: string; large?: boolean }) {
  const points = cubicBezier(easing);
  const size = large ? 96 : 40;
  if (!points) return <span className={styles.curve} data-large={large || undefined} aria-hidden="true" />;
  const [x1, y1, x2, y2] = points;
  const path = `M0 ${size} C${x1 * size} ${size - y1 * size} ${x2 * size} ${size - y2 * size} ${size} 0`;
  return <svg className={styles.curve} data-large={large || undefined} viewBox={`0 -8 ${size} ${size + 16}`} aria-hidden="true">
    <path d={`M0 ${size} L${size} 0`} className={styles.curveGuide} />
    <path d={path} className={styles.curveLine} />
  </svg>;
}

function Demo({ label, resolved }: { label: string; resolved: Resolved }) {
  const [played, setPlayed] = useState(false);
  return <div className={styles.demo}>
    <span className={styles.track} data-played={played || undefined} aria-hidden="true">
      <span className={styles.puck} style={{ transitionDuration: `${resolved.duration}ms`, transitionTimingFunction: resolved.easing }} />
    </span>
    <Button variant="outline" size="sm" aria-label={`Play ${label}`} onClick={() => setPlayed((value) => !value)}>Play</Button>
  </div>;
}

function usedBy(uses: MotionUse[]): string {
  return uses.map((use) => `${use.component}${use.variant ? ` (${use.variant})` : ""} · ${use.properties}`).join("; ");
}

export function MotionPage() {
  const reduced = useReducedMotion();
  const resolve = useResolver();
  const { timings, press, uses } = foundations.motion;
  const sheet = uses.find((use) => use.component === "drawer" && use.variant === "" && use.properties.includes("transform"));
  const sheetTiming = sheet ? resolve(sheet) : null;
  return <>
    <p className={styles.summary}>
      Transitions declared by the {foundations.owned} owned components in <code>components/ui/</code>, resolved against the rendered theme.
    </p>
    {reduced && <p className={styles.callout} role="status">Reduced motion is on. Previews jump to their end state, as Home does.</p>}
    {sheet && sheetTiming && <section className={styles.section} aria-labelledby="motion-sheet">
      <h3 id="motion-sheet" className={styles.sectionTitle}>Sheet</h3>
      <div className={styles.sheetCard}>
        <Curve easing={sheetTiming.easing} large />
        <div className={styles.sheetFacts}>
          <span className={styles.sheetValue}>{sheetTiming.duration} ms</span>
          <code>{formatEasing(sheetTiming.easing)}</code>
          <span className={styles.meta}>{sheet.component} · {sheet.properties}</span>
        </div>
        <Demo label={`sheet, ${sheetTiming.duration} ms`} resolved={sheetTiming} />
      </div>
    </section>}
    <section className={styles.section} aria-labelledby="motion-timings">
      <h3 id="motion-timings" className={styles.sectionTitle}>Timings<span className={styles.sectionCount}>{timings.length}</span></h3>
      <table className={`${styles.scaleTable} ${styles.motionTable}`}>
        <thead><tr><th scope="col">Duration</th><th scope="col">Easing</th><th scope="col">Used by</th><th scope="col">Preview</th></tr></thead>
        <tbody>
          {timings.map((timing) => {
            const resolved = resolve(timing);
            const key = `${timing.duration}-${timing.easing}`;
            return <tr key={key}>
              <th scope="row" className={styles.numeric}>{resolved.duration} ms
                <span className={styles.meta}>{resolved.durationSource}</span></th>
              <td><span className={styles.easing}><Curve easing={resolved.easing} />
                <span><code>{formatEasing(resolved.easing)}</code><span className={styles.meta}>{resolved.easingSource}</span></span></span></td>
              <td className={styles.usedBy}>{usedBy(timing.uses)}</td>
              <td><Demo label={`${resolved.duration} ms ${formatEasing(resolved.easing)}`} resolved={resolved} /></td>
            </tr>;
          })}
        </tbody>
      </table>
    </section>
    {press.length > 0 && <section className={styles.section} aria-labelledby="motion-press">
      <h3 id="motion-press" className={styles.sectionTitle}>Press</h3>
      <ul className={styles.tileGrid}>
        {[...new Set(press.map((entry) => entry.scale))].map((scale) => <li key={scale} className={styles.tile}>
          <button type="button" className={styles.pressDemo} style={{ ["--press-scale" as string]: scale }}>Press</button>
          <code>active:scale-[{scale}]</code>
          <span className={styles.meta}>{[...new Set(press.filter((entry) => entry.scale === scale).map((entry) => entry.component))].join(", ")}</span>
        </li>)}
      </ul>
    </section>}
  </>;
}
