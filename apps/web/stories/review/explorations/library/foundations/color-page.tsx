import { useMemo } from "react";
import { CheckIcon, XIcon } from "lucide-react";
import { formatRatio } from "./contrast";
import { measureColor, measurementSummary, type ColorMeasurement } from "./color-measurements";
import { foundations } from "./model";
import type { ThemeName, ThemeValues } from "./probe";
import type { ContrastRule } from "./tokens";
import styles from "./foundations.module.css";

const THEMES: ThemeName[] = ["light", "dark"];
const THEME_LABEL: Record<ThemeName, string> = { light: "Light", dark: "Dark" };
const FAMILY_LABEL: Record<string, string> = {
  surface: "Surface", text: "Text", primary: "Primary", status: "Status", market: "Market",
  balance: "Balance", payout: "Payout", globe: "Globe",
};


function ruleLabel(rule: ContrastRule): string {
  if (rule.use === "text" || rule.use === "graphic") {
    const target = rule.against === "surfaces" ? "card and page" : `--${rule.against.pair}`;
    return `${rule.use === "text" ? "Text" : "Graphic"} · ${rule.min}:1 on ${target}`;
  }
  return { surface: "Surface · reference only", brand: "Brand mark · keeps brand colour",
    illustration: "Illustration · reference only", pattern: "Pattern fill" }[rule.use];
}


function useColorMeasurements(snapshot: ThemeValues | null) {
  return useMemo(() => snapshot ? foundations.colors.map((token) => ({
    token,
    light: measureColor(token, snapshot.light),
    dark: measureColor(token, snapshot.dark),
  })) : null, [snapshot]);
}

export function ColorPage({ snapshot }: { snapshot: ThemeValues | null }) {
  const rows = useColorMeasurements(snapshot);
  if (!rows) return <p className={styles.note} role="status">Theme measurements unavailable.</p>;
  const families = [...new Set(rows.map((row) => row.token.family))];
  return <>
    <p className={styles.summary}>
      {THEMES.map((theme) => {
        const failed = rows.filter((row) => row[theme].verdict === "fail").map((row) => `--${row.token.name}`);
        return <span key={theme} className={styles.summaryLine}>
          {THEME_LABEL[theme]}: {measurementSummary(rows.map((row) => row[theme]), failed)}
        </span>;
      })}
    </p>
    <p className={styles.note}>Text needs 4.5:1, graphics 3:1, on card and page. From <code>app/globals.css</code>.</p>
    {families.map((family) => {
      const members = rows.filter((row) => row.token.family === family);
      const headingId = `color-family-${family}`;
      return <section key={family} className={styles.section} aria-labelledby={headingId}>
        <h3 id={headingId} className={styles.sectionTitle}>{FAMILY_LABEL[family] ?? family}
          <span className={styles.sectionCount}>{members.length}</span></h3>
        <table className={styles.colorTable}>
          <thead>
            <tr><th scope="col">Token</th>{THEMES.map((theme) => <th key={theme} scope="col">{THEME_LABEL[theme]}</th>)}</tr>
          </thead>
          <tbody>
            {members.map(({ token, light, dark }) => <tr key={token.name} data-token={token.name}>
              <th scope="row" className={styles.tokenCell}>
                <code className={styles.tokenName}>--{token.name}</code>
                <span className={styles.tokenRule}>{ruleLabel(token.rule)}</span>
                {token.rootOnly && <span className={styles.tokenRule}>Same value in both themes</span>}
              </th>
              {THEMES.map((theme) => <SwatchCell key={theme} theme={theme} measured={theme === "light" ? light : dark}
                surface={snapshot![theme]} />)}
            </tr>)}
          </tbody>
        </table>
      </section>;
    })}
  </>;
}

function SwatchCell({ theme, measured, surface }: { theme: ThemeName; measured: ColorMeasurement; surface: Record<string, string> }) {
  return <td data-theme-cell={theme}><div className={styles.swatchCell}>
    <span className={styles.swatchPlate} style={{ background: surface.card, borderColor: surface.border }} aria-hidden="true">
      <span className={styles.swatch} style={{ background: measured.value }} />
    </span>
    <span className={styles.swatchText}>
      <code className={styles.hex}>{measured.hex ?? measured.value}</code>
      {measured.checks.length > 0 && <span className={styles.ratios}>
        {measured.checks.map((check) => <span key={check.label}>{check.label} {formatRatio(check.ratio)}</span>)}
      </span>}
    </span>
    {measured.status === "unavailable" && <span className={styles.meta}>Unavailable</span>}
    {measured.verdict && <span className={styles.verdict} data-verdict={measured.verdict}>
      {measured.verdict === "pass" ? <CheckIcon aria-hidden="true" /> : <XIcon aria-hidden="true" />}
      {measured.verdict === "pass" ? "Pass" : "Fail"}
    </span>}
  </div></td>;
}
