import { useMemo, type ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import { foundations } from "./model";
import { utilityValues } from "./probe";
import type { Usage } from "./usage";
import local from "./elevation-states.module.css";
import styles from "./foundations.module.css";

type Level = {
  id: "raised" | "floating" | "overlay" | "toast";
  name: string;
  role: string;
  files: string[];
  light: string;
  dark: string;
  why: (count: (step: string) => number) => string;
};

const LEVELS: Level[] = [
  {
    id: "raised", name: "Raised", role: "Cards and small controls resting on content",
    files: ["card.tsx", "pull-to-refresh.tsx", "switch.tsx", "conversation.tsx"],
    light: "1px ring foreground/10 + 0 1px 2px black/5%",
    dark: "1px ring foreground/10, no shadow",
    why: (count) => `Folds the card ring, ${count("xs")} shadow-xs and ${count("sm")} shadow-sm uses into one step. In Dark a black shadow on the darker page reads as a smudge, so the ring alone carries the edge.`,
  },
  {
    id: "floating", name: "Floating", role: "Anchored popups: popover, select, combobox",
    files: ["popover.tsx", "select.tsx", "combobox.tsx", "coverage-status-preview.tsx"],
    light: "1px ring foreground/10 + shadow-md",
    dark: "1px ring foreground/15 + 0 4px 12px black/40%",
    why: (count) => `Keeps the ${count("md")} shadow-md popups; the coverage preview's border and shadow-lg join them. Dark popups share the card's lightness, so the ring rises to 15% and the shadow deepens to stay visible.`,
  },
  {
    id: "overlay", name: "Overlay", role: "Dialog and drawer over a scrim",
    files: ["dialog.tsx", "drawer.tsx"],
    light: "1px ring foreground/10 + shadow-lg",
    dark: "1px ring foreground/10, no shadow",
    why: (count) => `Splits today's ${count("lg")} shadow-lg uses by role and gives the drawer the dialog's ring. The scrim already separates an overlay from the page and hides a Dark shadow, so Dark drops it.`,
  },
  {
    id: "toast", name: "Toast", role: "Notices over live content, no scrim",
    files: ["toast.tsx"],
    light: "1px ring foreground/10 + shadow-lg",
    dark: "1px ring foreground/15 + 0 8px 24px black/50%",
    why: (count) => `The only top-level surface drawn with a border; a ring matches the ${count("ring-foreground/10")} ring-foreground/10 surfaces. Without a scrim it needs the strongest Dark lift of the four.`,
  },
];

function layers(value: string): string {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index <= value.length; index += 1) {
    const char = value[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if ((char === "," && depth === 0) || index === value.length) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  return parts.filter((part) => part && !/^rgba\(0, 0, 0, 0\) 0px 0px 0px 0px$/.test(part) && part !== "none").join(", ");
}

function fileUses(file: string, usage: Usage[]): string[] {
  return usage.filter((entry) => entry.files.some((path) => path.endsWith(`/${file}`))).map((entry) => entry.step);
}

function Specimen({ level, className }: { level: Level["id"]; className: string }) {
  const surface: Record<Level["id"], ReactNode> = {
    raised: <Card size="sm" className={className}>
      <CardHeader><CardTitle>Cash</CardTitle><CardDescription>$1,240.00 available</CardDescription></CardHeader>
      <CardContent className={local.inline}><span>Round up</span><Switch defaultChecked aria-label="Round up" /></CardContent>
    </Card>,
    floating: <div className={className}>
      <Item size="xs"><ItemContent><ItemTitle>Checking ••42</ItemTitle></ItemContent></Item>
      <Item size="xs"><ItemContent><ItemTitle>Savings ••07</ItemTitle></ItemContent></Item>
    </div>,
    overlay: <div className={className}>
      <Item><ItemContent><ItemTitle>Send $25.00 to Alex</ItemTitle><ItemDescription>Arrives in seconds</ItemDescription></ItemContent></Item>
    </div>,
    toast: <div className={className}>
      <Item size="sm"><ItemContent><ItemTitle>Sent $25.00</ItemTitle><ItemDescription>Alex will see it now</ItemDescription></ItemContent></Item>
    </div>,
  };
  return <div className={local.plate} data-level={level}>{surface[level]}</div>;
}

const CURRENT_CLASS: Record<Level["id"], string> = {
  raised: "",
  floating: "rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10",
  overlay: "rounded-xl bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10",
  toast: "rounded-2xl border bg-popover text-popover-foreground shadow-lg",
};

const PROPOSED_CLASS: Record<Level["id"], string> = {
  raised: local.raised,
  floating: `rounded-lg bg-popover p-1 text-popover-foreground ${local.floating}`,
  overlay: `rounded-xl bg-popover text-popover-foreground ${local.overlay}`,
  toast: `rounded-2xl bg-popover text-popover-foreground ${local.toast}`,
};

export function ElevationPage({ theme }: { theme: string }) {
  const { shadows, rings } = foundations.elevation;
  const rows = useMemo(() => [
    ...shadows.map((entry) => ({ entry, name: `shadow-${entry.step}`, probe: `shadow-${entry.step}` })),
    ...rings.map((entry) => ({ entry, name: entry.step, probe: "ring-1 ring-foreground/10" })),
  ], [shadows, rings]);
  const values = useMemo(() => utilityValues(rows.map(({ probe }) => probe), "boxShadow"), [rows]);
  const count = (step: string) => (shadows.find((entry) => entry.step === step) ?? rings.find((entry) => entry.step === step))?.count ?? 0;
  return <div className={local.page} data-theme={theme === "dark" ? "dark" : "light"}>
    <p className={styles.summary}>
      Shadow and ring utilities Tailwind generates from component source, with the files they appear in. Counts span {foundations.scanned} files in <code>components/</code>.
      Each owned surface picks its own step today; the proposal names four levels with separately reasoned Light and Dark values.
    </p>
    <section className={styles.section} aria-labelledby="elevation-current">
      <h3 id="elevation-current" className={styles.sectionTitle}>Current usage<span className={styles.sectionCount}>{rows.length}</span></h3>
      <table className={`${styles.scaleTable} ${local.usageTable}`}>
        <thead><tr><th scope="col">Utility</th><th scope="col">Occurrences</th><th scope="col">Files</th></tr></thead>
        <tbody>{rows.map(({ entry, name, probe }) => <tr key={name}>
          <th scope="row"><code>{name}</code>{layers(values[probe] ?? "") &&
            <span className={local.value}>{layers(values[probe])}</span>}</th>
          <td className={styles.numeric}>{entry.count}</td>
          <td className={styles.occurrences}>{entry.files.map((file) => <span key={file} className={styles.meta}>{file}</span>)}</td>
        </tr>)}</tbody>
      </table>
    </section>
    <section className={styles.section} aria-labelledby="elevation-proposal">
      <h3 id="elevation-proposal" className={styles.sectionTitle}>Proposed levels<span className={styles.sectionCount}>{LEVELS.length}</span></h3>
      <ol className={local.levels}>
        {LEVELS.map((level) => <li key={level.id} className={local.level} aria-labelledby={`level-${level.id}`}>
          <div className={local.levelHead}>
            <h4 id={`level-${level.id}`} className={local.levelName}>{level.name}</h4>
            <span className={styles.meta}>{level.role}</span>
          </div>
          <div className={local.compare}>
            <figure className={local.figure}>
              <Specimen level={level.id} className={CURRENT_CLASS[level.id]} />
              <figcaption><span className={local.label}>Current</span>
                {level.files.map((file) => <span key={file} className={styles.meta}>
                  {file} · <code>{[...fileUses(file, shadows).map((step) => `shadow-${step}`), ...fileUses(file, rings)].join(" ") || "none"}</code>
                </span>)}
              </figcaption>
            </figure>
            <figure className={local.figure}>
              <Specimen level={level.id} className={PROPOSED_CLASS[level.id]} />
              <figcaption><span className={local.label}>Proposed</span>
                <dl className={local.values}>
                  <div data-active={theme !== "dark" || undefined}><dt>Light</dt><dd>{level.light}</dd></div>
                  <div data-active={theme === "dark" || undefined}><dt>Dark</dt><dd>{level.dark}</dd></div>
                </dl>
              </figcaption>
            </figure>
          </div>
          <p className={local.why}>{level.why(count)}</p>
        </li>)}
      </ol>
    </section>
  </div>;
}
