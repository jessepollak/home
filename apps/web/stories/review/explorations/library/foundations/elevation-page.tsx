import { useMemo, type ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import { foundations } from "./model";
import { utilityValues } from "./probe";
import local from "./elevation-states.module.css";
import styles from "./foundations.module.css";

type Level = {
  id: "raised" | "floating" | "overlay" | "toast";
  name: string;
  role: string;
  files: string[];
  light: string;
  dark: string;
  why: string;
};

const LEVELS: Level[] = [
  {
    id: "raised", name: "Raised", role: "Cards and small controls resting on content",
    files: ["card.tsx", "pull-to-refresh.tsx", "switch.tsx", "conversation.tsx"],
    light: "1px ring foreground/10 + 0 1px 2px black/5%",
    dark: "1px ring foreground/10, no shadow",
    why: "A faint lift separates resting surfaces in Light. In Dark the ring alone carries the edge without a smudged shadow.",
  },
  {
    id: "floating", name: "Floating", role: "Anchored popups: popover, select, combobox",
    files: ["popover.tsx", "select.tsx", "combobox.tsx", "coverage-status-preview.tsx"],
    light: "1px ring foreground/10 + shadow-md",
    dark: "1px ring foreground/15 + 0 4px 12px black/40%",
    why: "Anchored popups share one level. Dark popups use a stronger ring and deeper shadow to stay visible above the card.",
  },
  {
    id: "overlay", name: "Overlay", role: "Dialog and drawer over a scrim",
    files: ["dialog.tsx", "drawer.tsx"],
    light: "1px ring foreground/10 + shadow-lg",
    dark: "1px ring foreground/10, no shadow",
    why: "The scrim separates the overlay from the page. Dialog and Drawer share a ring; Dark needs no extra shadow.",
  },
  {
    id: "toast", name: "Toast", role: "Notices over live content, no scrim",
    files: ["toast.tsx"],
    light: "1px ring foreground/10 + shadow-lg",
    dark: "1px ring foreground/15 + 0 8px 24px black/50%",
    why: "A notice sits above live content without a scrim, so it has the strongest Dark lift of the four levels.",
  },
];

function isEmptyLayer(part: string): boolean {
  let lengths = part;
  while (/[a-z-]+\([^()]*\)/i.test(lengths)) lengths = lengths.replace(/[a-z-]+\([^()]*\)/gi, " ");
  const tokens = lengths.replace(/#[0-9a-f]+/gi, " ").split(/\s+/)
    .filter((token) => token && !/^(?:inset|transparent|currentcolor)$/i.test(token));
  return tokens.every((token) => /^0(?:px)?$/.test(token));
}

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
  return parts.filter((part) => part && part !== "none" && !isEmptyLayer(part)).join(", ");
}

function Specimen({ level }: { level: Level["id"] }) {
  const surface: Record<Level["id"], ReactNode> = {
    raised: <Card size="sm">
      <CardHeader><CardTitle>Cash</CardTitle><CardDescription>$1,240.00 available</CardDescription></CardHeader>
      <CardContent className={local.inline}><span>Round up</span><Switch defaultChecked aria-label="Round up" /></CardContent>
    </Card>,
    floating: <div className="rounded-xl bg-popover p-1 text-popover-foreground shadow-floating">
      <Item size="xs"><ItemContent><ItemTitle>Checking ••42</ItemTitle></ItemContent></Item>
      <Item size="xs"><ItemContent><ItemTitle>Savings ••07</ItemTitle></ItemContent></Item>
    </div>,
    overlay: <div className="rounded-2xl bg-popover text-popover-foreground shadow-overlay">
      <Item><ItemContent><ItemTitle>Send $25.00 to Alex</ItemTitle><ItemDescription>Arrives in seconds</ItemDescription></ItemContent></Item>
    </div>,
    toast: <div className="rounded-xl bg-popover text-popover-foreground shadow-toast">
      <Item size="sm"><ItemContent><ItemTitle>Sent $25.00</ItemTitle><ItemDescription>Alex will see it now</ItemDescription></ItemContent></Item>
    </div>,
  };
  return <div className={local.plate} data-level={level}>{surface[level]}</div>;
}

export function ElevationPage({ theme }: { theme: string }) {
  const { shadows, rings } = foundations.elevation;
  const rows = useMemo(() => [
    ...shadows.map((entry) => ({ entry, name: `shadow-${entry.step}`, probe: `shadow-${entry.step}` })),
    ...rings.map((entry) => ({ entry, name: entry.step, probe: entry.step === "ring-1" ? "ring-1" : `ring-1 ${entry.step}` })),
  ], [shadows, rings]);
  const values = useMemo(() => utilityValues(rows.map(({ probe }) => probe), "boxShadow"), [rows]);
  return <div>
    <p className={styles.summary}>
      Shadow and ring utilities Tailwind generates from component source, with the files they appear in. Counts span {foundations.scanned} files in <code>components/</code>; each utility is measured on its own, with ring colours on a 1px ring.
      Owned surfaces use four named levels with separately reasoned Light and Dark values.
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
    <section className={styles.section} aria-labelledby="elevation-levels">
      <h3 id="elevation-levels" className={styles.sectionTitle}>Levels<span className={styles.sectionCount}>{LEVELS.length}</span></h3>
      <ol className={local.levels}>
        {LEVELS.map((level) => <li key={level.id} className={local.level} aria-labelledby={`level-${level.id}`}>
          <div className={local.levelHead}>
            <h4 id={`level-${level.id}`} className={local.levelName}>{level.name}</h4>
            <span className={styles.meta}>{level.role}</span>
          </div>
          <figure className={local.figure}>
            <Specimen level={level.id} />
            <figcaption>
              <code>{`shadow-${level.id}`}</code>
              {level.files.map((file) => <span key={file} className={styles.meta}>{file}</span>)}
              <dl className={local.values}>
                <div data-active={theme !== "dark" || undefined}><dt>Light</dt><dd>{level.light}</dd></div>
                <div data-active={theme === "dark" || undefined}><dt>Dark</dt><dd>{level.dark}</dd></div>
              </dl>
            </figcaption>
          </figure>
          <p className={local.why}>{level.why}</p>
        </li>)}
      </ol>
    </section>
  </div>;
}
