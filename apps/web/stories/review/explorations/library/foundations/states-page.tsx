import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Item, ItemContent, ItemTitle } from "@/components/ui/item";
import { Toggle } from "@/components/ui/toggle";
import { foundations } from "./model";
import type { InteractionState } from "./usage";
import local from "./elevation-states.module.css";
import styles from "./foundations.module.css";

const STATES: { id: InteractionState; name: string }[] = [
  { id: "hover", name: "Hover / highlight" },
  { id: "pressed", name: "Pressed" },
  { id: "focus", name: "Focus-visible" },
  { id: "disabled", name: "Disabled" },
  { id: "selected", name: "Selected" },
];

const COMPONENTS = [
  { id: "button", name: "Button" }, { id: "item", name: "Item" }, { id: "toggle", name: "Toggle" },
  { id: "input", name: "Input" }, { id: "select", name: "Select" }, { id: "combobox", name: "Combobox" },
];

const CONTRACT: { state: InteractionState; treatment: string; light: string; dark: string; replaces: string[] }[] = [
  { state: "hover", treatment: "Foreground tint; menu keyboard highlight matches pointer hover. Inputs darken their border instead",
    light: "foreground 5%", dark: "foreground 7%", replaces: ["hover:bg-muted", "dark:hover:bg-muted/50", "dark:hover:bg-input/50", "focus:bg-accent", "data-highlighted:bg-accent"] },
  { state: "pressed", treatment: "Tint steps up while held; Button keeps its press prop",
    light: "foreground 8%", dark: "foreground 11%", replaces: ["active:bg-muted", "dark:active:bg-muted/50", "dark:active:bg-input/50"] },
  { state: "focus", treatment: "Neutral ring outside, inset on flush rows; unchanged",
    light: "border-ring + 3px ring/50", dark: "border-ring + 3px ring/50", replaces: ["focus-visible:border-ring", "focus-visible:ring-3", "focus-visible:ring-ring/50"] },
  { state: "disabled", treatment: "Half opacity over the rest fill; no extra fill or hover",
    light: "opacity 50%", dark: "opacity 50%", replaces: ["disabled:opacity-50", "data-disabled:opacity-50", "disabled:bg-input/50", "dark:disabled:bg-input/80"] },
  { state: "selected", treatment: "Holds the pressed tint with foreground text",
    light: "foreground 8%", dark: "foreground 11%", replaces: ["aria-pressed:bg-muted", "data-[state=on]:bg-muted", "aria-expanded:bg-muted"] },
];

function totals() {
  const counts = new Map<string, number>();
  for (const use of foundations.states) for (const { name, count } of use.classes) counts.set(name, (counts.get(name) ?? 0) + count);
  return counts;
}

type Demo = InteractionState | "rest";

const SPECIMENS: { name: string; supports: Demo[]; render: (demo: Demo, props: { "data-demo"?: Demo }) => ReactNode }[] = [
  { name: "Button outline", supports: ["rest", "hover", "pressed", "focus", "disabled", "selected"],
    render: (demo, props) => <Button variant="outline" className={`${local.contract} ${local.press}`} disabled={demo === "disabled"}
      aria-pressed={demo === "selected" || undefined} {...props}>Send</Button> },
  { name: "Button ghost", supports: ["rest", "hover", "pressed", "focus", "disabled", "selected"],
    render: (demo, props) => <Button variant="ghost" className={`${local.contract} ${local.press}`} disabled={demo === "disabled"}
      aria-pressed={demo === "selected" || undefined} {...props}>Send</Button> },
  { name: "Toggle", supports: ["rest", "hover", "pressed", "focus", "disabled", "selected"],
    render: (demo, props) => <Toggle variant="outline" className={local.contract} disabled={demo === "disabled"}
      pressed={demo === "selected"} {...props}>Hide</Toggle> },
  { name: "Item row", supports: ["rest", "hover", "pressed", "focus", "disabled", "selected"],
    render: (demo, props) => <Item size="xs" className={local.contract}
      render={<button type="button" aria-label="Savings" disabled={demo === "disabled"} />} {...props}><ItemContent><ItemTitle>Savings</ItemTitle></ItemContent></Item> },
  { name: "Input", supports: ["rest", "hover", "focus", "disabled"],
    render: (demo, props) => <Input className={`${local.contract} ${local.input}`} aria-label="Amount" placeholder="$0.00"
      disabled={demo === "disabled"} {...props} /> },
];

export function StatesPage({ theme }: { theme: string }) {
  const counts = totals();
  const files = new Set(foundations.states.map(({ component }) => component)).size;
  const byState = (state: InteractionState) => foundations.states.filter((use) => use.state === state);
  return <div className={local.page} data-theme={theme === "dark" ? "dark" : "light"}>
    <p className={styles.summary}>
      State utilities Tailwind generates from {files} owned component files, grouped by the variant that applies them. A class lands in one state, the first
      that matches in the order disabled, focus-visible, pressed, selected, hover; menu <code>focus:</code> and <code>data-highlighted</code> count as highlight.
      Each component sets its own treatment today; the proposal is one contract every component draws from.
    </p>
    <section className={styles.section} aria-labelledby="states-current">
      <h3 id="states-current" className={styles.sectionTitle}>Current usage
        <span className={styles.sectionCount}>{counts.size}</span></h3>
      <table className={`${styles.scaleTable} ${local.matrix}`}>
        <thead><tr><th scope="col">Component</th>{STATES.map((state) => <th key={state.id} scope="col">{state.name}</th>)}</tr></thead>
        <tbody>{COMPONENTS.map((component) => <tr key={component.id}>
          <th scope="row">{component.name}<span className={styles.meta}>{component.id}.tsx</span></th>
          {STATES.map((state) => {
            const use = foundations.states.find((entry) => entry.component === component.id && entry.state === state.id);
            return <td key={state.id}>{use ? use.classes.map(({ name, count }) => <code key={name} className={local.classLine}>
              {name}{count > 1 ? ` ×${count}` : ""}</code>) : <span className={styles.meta}>None</span>}</td>;
          })}
        </tr>)}</tbody>
      </table>
      <p className={styles.note}>
        {STATES.map((state) => `${state.name}: ${new Set(byState(state.id).flatMap((use) => use.classes.map(({ name }) => name))).size} utilities in ${byState(state.id).length} files`).join(" · ")}.
      </p>
    </section>
    <section className={styles.section} aria-labelledby="states-contract">
      <h3 id="states-contract" className={styles.sectionTitle}>Proposed contract<span className={styles.sectionCount}>{CONTRACT.length}</span></h3>
      <table className={`${styles.scaleTable} ${local.contractTable}`}>
        <thead><tr><th scope="col">State</th><th scope="col">Treatment</th><th scope="col">Light</th><th scope="col">Dark</th><th scope="col">Replaces, in these {files} files</th></tr></thead>
        <tbody>{CONTRACT.map((row) => <tr key={row.state}>
          <th scope="row">{STATES.find((state) => state.id === row.state)!.name}</th>
          <td>{row.treatment}</td>
          <td data-active={theme !== "dark" || undefined}><code>{row.light}</code></td>
          <td data-active={theme === "dark" || undefined}><code>{row.dark}</code></td>
          <td className={styles.occurrences}>{row.replaces.map((name) => <code key={name} className={local.classLine}>
            {name} ×{counts.get(name) ?? 0}</code>)}</td>
        </tr>)}</tbody>
      </table>
      <p className={styles.note}>
        Dark <code>--muted</code> sits below the surface and <code>--accent</code> above it, so ghost and toggle hovers darken while outline and menu hovers lighten.
        A foreground tint always lifts in Dark; it takes two more points to match the Light step on the darker surface.
      </p>
    </section>
    <section className={styles.section} aria-labelledby="states-specimens">
      <h3 id="states-specimens" className={styles.sectionTitle}>Proposed on owned components</h3>
      <p className={styles.note}>Each column holds its state; hover, press and Tab the Rest column to try it live.</p>
      <table className={`${styles.scaleTable} ${local.specimens}`}>
        <thead><tr><th scope="col">Component</th><th scope="col">Rest</th>{STATES.map((state) => <th key={state.id} scope="col">{state.name}</th>)}</tr></thead>
        <tbody>{SPECIMENS.map((specimen) => <tr key={specimen.name}>
          <th scope="row">{specimen.name}</th>
          {(["rest", ...STATES.map(({ id }) => id)] as Demo[]).map((demo) => specimen.supports.includes(demo)
            ? <td key={demo}>{specimen.render(demo, demo === "rest" ? {} : { "data-demo": demo })}</td>
            : <td key={demo}><span className={styles.meta}>—</span></td>)}
        </tr>)}</tbody>
      </table>
    </section>
  </div>;
}
