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

const CONTRACT: { state: InteractionState; treatment: string; light: string; dark: string }[] = [
  { state: "hover", treatment: "bg-state-hover; menu keyboard highlight matches pointer hover. Fields use border-input-hover instead (foreground 24% over input)",
    light: "foreground 5%", dark: "foreground 7%" },
  { state: "pressed", treatment: "bg-state-pressed while held; Button keeps its press prop",
    light: "foreground 8%", dark: "foreground 11%" },
  { state: "focus", treatment: "Neutral ring outside, inset on flush rows",
    light: "border-ring + 3px ring/50", dark: "border-ring + 3px ring/50" },
  { state: "disabled", treatment: "Half opacity over the rest fill; no extra fill or hover",
    light: "opacity 50%", dark: "opacity 50%" },
  { state: "selected", treatment: "bg-state-pressed with foreground text",
    light: "foreground 8%", dark: "foreground 11%" },
];

function totals() {
  const counts = new Map<string, number>();
  for (const use of foundations.states) for (const { name, count } of use.classes) counts.set(name, (counts.get(name) ?? 0) + count);
  return counts;
}

type Demo = InteractionState | "rest";

const SPECIMENS: { name: string; supports: Demo[]; render: (demo: Demo, props: { "data-demo"?: Demo }) => ReactNode }[] = [
  { name: "Button outline", supports: ["rest", "hover", "pressed", "focus", "disabled", "selected"],
    render: (demo, props) => <Button variant="outline" className={local.demo} disabled={demo === "disabled"}
      aria-expanded={demo === "selected" || undefined} {...props}>Send</Button> },
  { name: "Button ghost", supports: ["rest", "hover", "pressed", "focus", "disabled", "selected"],
    render: (demo, props) => <Button variant="ghost" className={local.demo} disabled={demo === "disabled"}
      aria-expanded={demo === "selected" || undefined} {...props}>Send</Button> },
  { name: "Toggle", supports: ["rest", "hover", "pressed", "focus", "disabled", "selected"],
    render: (demo, props) => <Toggle variant="outline" className={local.demo} disabled={demo === "disabled"}
      pressed={demo === "selected"} {...props}>Hide</Toggle> },
  { name: "Item row", supports: ["rest", "hover", "pressed", "focus"],
    render: (_demo, props) => <Item size="xs" className={local.demo}
      render={<button type="button" aria-label="Savings" />} {...props}><ItemContent><ItemTitle>Savings</ItemTitle></ItemContent></Item> },
  { name: "Input", supports: ["rest", "hover", "focus", "disabled"],
    render: (demo, props) => <Input className={local.demo} aria-label="Amount" placeholder="$0.00"
      disabled={demo === "disabled"} {...props} /> },
];

export function StatesPage({ theme }: { theme: string }) {
  const counts = totals();
  const files = new Set(foundations.states.map(({ component }) => component)).size;
  const byState = (state: InteractionState) => foundations.states.filter((use) => use.state === state);
  return <div>
    <p className={styles.summary}>
      State utilities Tailwind generates from {files} owned component files, grouped by the variant that applies them. A class lands in one state, the first
      that matches in the order disabled, focus-visible, pressed, selected, hover; menu <code>focus:</code> and <code>data-highlighted</code> count as highlight.
      Neutral controls share one contract; filled Button variants keep their own tone steps.
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
      <h3 id="states-contract" className={styles.sectionTitle}>Contract<span className={styles.sectionCount}>{CONTRACT.length}</span></h3>
      <table className={`${styles.scaleTable} ${local.contractTable}`}>
        <thead><tr><th scope="col">State</th><th scope="col">Treatment</th><th scope="col">Light</th><th scope="col">Dark</th></tr></thead>
        <tbody>{CONTRACT.map((row) => <tr key={row.state}>
          <th scope="row">{STATES.find((state) => state.id === row.state)!.name}</th>
          <td>{row.treatment}</td>
          <td data-active={theme !== "dark" || undefined}><code>{row.light}</code></td>
          <td data-active={theme === "dark" || undefined}><code>{row.dark}</code></td>
        </tr>)}</tbody>
      </table>
      <p className={styles.note}>
        A foreground tint consistently lifts neutral controls in Dark. Fields darken their border on hover; focus and invalid borders win over hover.
      </p>
    </section>
    <section className={styles.section} aria-labelledby="states-specimens">
      <h3 id="states-specimens" className={styles.sectionTitle}>Owned components</h3>
      <p className={styles.note}>Hover, pressed and focus-visible columns hold a static state using the theme tokens. Selected and disabled use component props; hover, press and Tab the Rest column to try it live.</p>
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
