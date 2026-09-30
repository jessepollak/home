import { useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { foundations } from "./model";
import { readMotionReference } from "./motion-values";
import { cubicBezier } from "./usage";
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

function Curve({ easing }: { easing: string }) {
  const points = cubicBezier(easing);
  const size = 40;
  if (!points) return <span className={styles.curve} aria-hidden="true" />;
  const [x1, y1, x2, y2] = points;
  const path = `M0 ${size} C${x1 * size} ${size - y1 * size} ${x2 * size} ${size - y2 * size} ${size} 0`;
  return <svg className={styles.curve} viewBox={`0 -8 ${size} ${size + 16}`} aria-hidden="true">
    <path d={`M0 ${size} L${size} 0`} className={styles.curveGuide} />
    <path d={path} className={styles.curveLine} />
  </svg>;
}

function Demo({ easing }: { easing: string }) {
  const [played, setPlayed] = useState(false);
  return <div className={styles.demo}>
    <span className={styles.track} data-played={played || undefined} aria-hidden="true">
      <span className={styles.puck} style={{ transitionDuration: "350ms", transitionTimingFunction: easing }} />
    </span>
    <Button variant="outline" size="sm" aria-label={`Play ${easing}`} onClick={() => setPlayed((value) => !value)}>Play</Button>
  </div>;
}

export function MotionPage() {
  const reduced = useReducedMotion();
  const { uses } = foundations.motion;
  const reference = useMemo(() => readMotionReference(uses), [uses]);
  if (!reference) return <p className={styles.note} role="status">Motion measurements unavailable.</p>;
  return <>
    <p className={styles.summary}>
      Utilities Tailwind generates from component source, with the files they appear in. A complete utility token in a comparison or other literal counts too.
      Values are measured individually without state or breakpoint conditions, not composed component timings. Tokens come from loaded stylesheets and resolve in the document scope.
    </p>
    {reduced && <p className={styles.callout} role="status">Reduced motion is on. Previews jump to their end state, as Home does.</p>}
    <section className={styles.section} aria-labelledby="motion-easings">
      <h3 id="motion-easings" className={styles.sectionTitle}>Easings<span className={styles.sectionCount}>{reference.easings.length}</span></h3>
      <p className={styles.note}>Each preview uses 350 ms to compare curves, not a component duration.</p>
      <table className={`${styles.scaleTable} ${styles.easingTable}`}>
        <thead><tr><th scope="col">Easing</th><th scope="col">Preview</th></tr></thead>
        <tbody>{reference.easings.map((easing) => <tr key={easing}>
          <th scope="row"><span className={styles.easing}><Curve easing={easing} /><code>{easing}</code></span></th>
          <td><Demo easing={easing} /></td>
        </tr>)}</tbody>
      </table>
    </section>
    <section className={styles.section} aria-labelledby="motion-utilities">
      <h3 id="motion-utilities" className={styles.sectionTitle}>Utilities<span className={styles.sectionCount}>{uses.length}</span></h3>
      <table className={`${styles.scaleTable} ${styles.motionTable}`}>
        <thead><tr><th scope="col">Utility</th><th scope="col">Computed value</th><th scope="col">Occurrences / files</th></tr></thead>
        <tbody>{uses.map((use) => <tr key={use.utility}>
          <th scope="row"><code>{use.utility}</code></th>
          <td>{reference.utilities[use.utility]?.map(({ property, value }) => <span key={property} className={styles.meta}>
            {property}<code className={styles.tokenName}>{value}</code>
          </span>) ?? <span className={styles.meta}>Unavailable</span>}</td>
          <td className={styles.occurrences}>{use.count} {use.count === 1 ? "occurrence" : "occurrences"}
            {use.files.map((file) => <span key={file} className={styles.meta}>{file}</span>)}</td>
        </tr>)}</tbody>
      </table>
    </section>
    <section className={styles.section} aria-labelledby="motion-tokens">
      <h3 id="motion-tokens" className={styles.sectionTitle}>Tokens<span className={styles.sectionCount}>{reference.tokens.length}</span></h3>
      <dl className={styles.stackList}>{reference.tokens.map(({ property, value }) => <div key={property} className={styles.stackRow}>
        <dt><code>{property}</code></dt><dd><code>{value}</code></dd>
      </div>)}</dl>
    </section>
  </>;
}
