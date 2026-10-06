import { useMemo } from "react";
import { foundations } from "./model";
import { measure, rootProperties, utilityValues } from "./probe";
import { ShapeRoles, TypeRoles } from "./role-sections";
import { radiusSteps } from "./tokens";
import type { Usage } from "./usage";
import styles from "./foundations.module.css";

const SPECIMEN = "Send $25.00 to Alex";

function px(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value > 100000) return "pill";
  return `${Number(value.toFixed(2))}px`;
}

function occurrences(count: number): string {
  return count === 1 ? "1 occurrence" : `${count} occurrences`;
}

function Files({ files }: { files: string[] }) {
  if (!files.length) return null;
  return <details><summary>Files ({files.length})</summary>
    {files.map((file) => <span key={file} className={styles.meta}>{file}</span>)}
  </details>;
}

function Occurrences({ entry }: { entry: Usage }) {
  return <>{occurrences(entry.count)}<Files files={entry.files} /></>;
}

export function TypePage() {
  const { sizes, arbitrarySizes, weights, leadings, trackings, tabular, mono } = foundations.type;
  const data = useMemo(() => {
    const names = [
      "font-sans", "font-mono",
      ...sizes.flatMap(({ step }) => [`text-${step}`, `text-${step}--line-height`]),
      ...weights.map(({ step }) => `font-weight-${step}`),
      ...leadings.map(({ step }) => `leading-${step}`),
      ...trackings.map(({ step }) => `tracking-${step}`),
    ];
    const computed = rootProperties(names);
    const utilityGroups = [
      [weights.map(({ step }) => `font-${step}`), "fontWeight"],
      [leadings.map(({ step }) => `leading-${step}`), "lineHeight"],
      [trackings.map(({ step }) => `tracking-${step}`), "letterSpacing"],
    ] as const;
    const utilities = Object.assign({}, ...utilityGroups.map(([names, property]) => utilityValues(names, property))) as Record<string, string>;
    const fontSizes = measure(Object.fromEntries(sizes.map(({ step }) => [step, `var(--text-${step})`])), "fontSize");
    const lineHeights = Object.fromEntries(sizes.map(({ step }) => {
      const probe = document.createElement("div");
      Object.assign(probe.style, { position: "absolute", visibility: "hidden", fontSize: `var(--text-${step})`,
        lineHeight: `var(--text-${step}--line-height)` });
      document.body.append(probe);
      const value = Number.parseFloat(getComputedStyle(probe).lineHeight);
      probe.remove();
      return [step, value];
    }));
    return { computed, utilities, fontSizes, lineHeights };
  }, [sizes, weights, leadings, trackings]);
  return <>
    <p className={styles.summary}>
      Utilities Tailwind generates from component source, with the files they appear in. Counts span {foundations.scanned} files in <code>components/</code>; values are measured from the loaded theme.
      A complete utility token in a comparison or other literal counts too.
    </p>
    <TypeRoles />
    <section className={styles.section} aria-labelledby="type-families">
      <h3 id="type-families" className={styles.sectionTitle}>Families</h3>
      <dl className={styles.stackList}>
        {(["sans", "mono"] as const).map((family) => <div key={family} className={styles.stackRow}>
          <dt><code>font-{family}</code></dt>
          <dd>
            <span className={styles.stackSpecimen} style={{ fontFamily: `var(--font-${family})` }}>
              {family === "sans" ? "Home keeps money simple" : "0x2211…7da9"}
            </span>
            <span className={styles.meta}>{data.computed[`font-${family}`]}</span>
          </dd>
        </div>)}
      </dl>
    </section>
    <section className={styles.section} aria-labelledby="type-sizes">
      <h3 id="type-sizes" className={styles.sectionTitle}>Sizes<span className={styles.sectionCount}>{sizes.length}</span></h3>
      <table className={styles.scaleTable}>
        <thead><tr><th scope="col">Utility</th><th scope="col">Size / line</th><th scope="col">Occurrences / files</th><th scope="col">Specimen</th></tr></thead>
        <tbody>
          {sizes.map(({ step, count, files }) => <tr key={step}>
            <th scope="row"><code>text-{step}</code></th>
            <td className={styles.numeric}>{px(data.fontSizes[step])} / {px(data.lineHeights[step])}</td>
            <td className={styles.numeric}>{count}<Files files={files} /></td>
            <td><span className={styles.specimen}
              style={{ fontSize: `var(--text-${step})`, lineHeight: `var(--text-${step}--line-height)` }}>{SPECIMEN}</span></td>
          </tr>)}
        </tbody>
      </table>
      {arbitrarySizes.length > 0 && <div className={styles.note}>
        Off-scale candidates: {arbitrarySizes.map((entry) => <div key={entry.step}><code>text-[{entry.step}]</code> · <Occurrences entry={entry} /></div>)}.
      </div>}
    </section>
    <section className={styles.section} aria-labelledby="type-weights">
      <h3 id="type-weights" className={styles.sectionTitle}>Weights</h3>
      <ul className={styles.tileGrid}>
        {weights.map(({ step, count, files }) => <li key={step} className={styles.tile}>
          <span className={styles.tileSpecimen} style={{ fontWeight: `var(--font-weight-${step})` }}>Aa</span>
          <code>font-{step}</code>
          <span className={styles.meta}>{data.computed[`font-weight-${step}`] || data.utilities[`font-${step}`]} · {occurrences(count)}</span>
          <Files files={files} />
        </li>)}
      </ul>
    </section>
    <section className={styles.section} aria-labelledby="type-rhythm">
      <h3 id="type-rhythm" className={styles.sectionTitle}>Line height and tracking overrides</h3>
      <ul className={styles.chipList}>
        {leadings.map(({ step, count, files }) => <li key={step}><code>leading-{step}</code>
          <span className={styles.meta}>{data.computed[`leading-${step}`] || data.utilities[`leading-${step}`]} · {occurrences(count)}</span><Files files={files} /></li>)}
        {trackings.map(({ step, count, files }) => <li key={step}><code>tracking-{step}</code>
          <span className={styles.meta}>{data.computed[`tracking-${step}`] || data.utilities[`tracking-${step}`]} · {occurrences(count)}</span><Files files={files} /></li>)}
      </ul>
    </section>
    <section className={styles.section} aria-labelledby="type-numerals">
      <h3 id="type-numerals" className={styles.sectionTitle}>Numbers and code</h3>
      <div className={styles.numeralGrid}>
        <figure className={styles.numeralCard}>
          <div className={styles.numeralPair}>
            <span className={styles.amounts}><span>$1,111.11</span><span>$8,406.90</span></span>
            <span className={styles.amounts} data-tabular=""><span>$1,111.11</span><span>$8,406.90</span></span>
          </div>
          <figcaption><code>tabular-nums</code> · <Occurrences entry={tabular} />. Money and other aligned numbers use tabular figures (right); proportional figures (left) drift.</figcaption>
        </figure>
        <figure className={styles.numeralCard}>
          <span className={styles.monoSpecimen}>0x2211d1d0020daea8039e46cf1367962070d77da9</span>
          <figcaption><code>font-mono</code> · <Occurrences entry={mono} />. Reserved for addresses, hashes and code.</figcaption>
        </figure>
      </div>
    </section>
  </>;
}


export function RadiusSpacingPage() {
  const { scale, usage } = foundations.radius;
  const { named, usage: spacing } = foundations.spacing;
  const data = useMemo(() => {
    const defined = new Map(scale.map((declaration) => [declaration.name, declaration.value]));
    const counts = new Map(usage.map((entry) => [entry.step, entry]));
    const steps = radiusSteps([...defined.keys()], [...counts.keys()]).map((step) => ({
      step,
      source: step === "full" ? "calc(infinity * 1px)" : defined.get(step) ?? `var(--radius-${step})`,
      owned: defined.has(step),
      count: counts.get(step)?.count ?? 0,
      files: counts.get(step)?.files ?? [],
    }));
    const radius = measure(Object.fromEntries(steps.map(({ step, source }) => [step, source])));
    const spacingSteps = [...spacing,
      ...named.filter(({ name }) => !spacing.some((entry) => entry.step === name)).map(({ name }) => ({ step: name, count: 0, files: [] }))];
    const expression = (step: string) => step === "px" ? "1px" : named.some(({ name }) => name === step)
      ? `var(--spacing-${step})` : `calc(var(--spacing) * ${step})`;
    const lengths = measure(Object.fromEntries(spacingSteps.map(({ step }) => [step, expression(step)])));
    const base = measure({ radius: "var(--radius)", spacing: "var(--spacing)" });
    return { steps, radius, spacingSteps, lengths, expression, base, tokens: rootProperties(["radius", "spacing"]) };
  }, [scale, usage, named, spacing]);
  return <>
    <p className={styles.summary}>
      Utilities Tailwind generates from component source, with the files they appear in. Counts span {foundations.scanned} files in <code>components/</code>.
      A complete utility token in a comparison or other literal counts too.
      <code>--radius</code> {data.tokens.radius} ({px(data.base.radius)}) and <code>--spacing</code> {data.tokens.spacing} ({px(data.base.spacing)}).
    </p>
    <section className={styles.section} aria-labelledby="radius-scale">
      <h3 id="radius-scale" className={styles.sectionTitle}>Radius<span className={styles.sectionCount}>{data.steps.length}</span></h3>
      <ul className={styles.tileGrid}>
        {data.steps.map(({ step, source, owned, count, files }) => <li key={step} className={styles.tile}>
          <span className={styles.radiusBox} style={{ borderRadius: source }} aria-hidden="true" />
          <code>rounded-{step}</code>
          <span className={styles.meta}>{px(data.radius[step])} · {occurrences(count)}</span>
          <Files files={files} />
          <span className={styles.meta}>{owned ? source : step === "full" ? "Tailwind stock" : "Tailwind stock, not in globals.css"}</span>
        </li>)}
      </ul>
    </section>
    <ShapeRoles />
    <section className={styles.section} aria-labelledby="spacing-scale">
      <h3 id="spacing-scale" className={styles.sectionTitle}>Spacing<span className={styles.sectionCount}>{data.spacingSteps.length}</span></h3>
      <table className={`${styles.scaleTable} ${styles.spacingTable}`}>
        <thead><tr><th scope="col">Step</th><th scope="col">Occurrences / files</th><th scope="col">Value</th></tr></thead>
        <tbody>
          {data.spacingSteps.map(({ step, count, files }) => <tr key={step}>
            <th scope="row"><code>{step}</code></th>
            <td className={styles.numeric}>{count}<Files files={files} /></td>
            <td className={styles.numeric}><span className={styles.spaceBar}
              style={{ width: data.expression(step), minWidth: data.lengths[step] > 0 ? 1 : 0 }} aria-hidden="true" />
              {px(data.lengths[step])}</td>
          </tr>)}
        </tbody>
      </table>
    </section>
  </>;
}
