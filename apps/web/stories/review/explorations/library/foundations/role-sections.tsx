import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { foundations } from "./model";
import { measure, rootProperties } from "./probe";
import { filesUsing, shapeNotes, shapeRoles, typeNotes, typeRoles, type ShapeScan } from "./role-proposals";
import type { Usage } from "./usage";
import roles from "./roles.module.css";
import styles from "./foundations.module.css";

const SPECIMENS: Record<string, string> = {
  amount: "$1,284.50",
  heading: "Add money",
  body: "Arrives from your bank in about a minute.",
  label: "Deposit",
  metadata: "Today, 9:41",
  numeric: "+$250.00",
  mono: "0x2211…7da9",
};

function px(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value > 100000) return "pill";
  return `${Number(value.toFixed(2))}px`;
}

function count(entries: Usage[], step: string) {
  return entries.find((entry) => entry.step === step)?.count ?? 0;
}

function typeCount(utility: string): number {
  const { sizes, weights, leadings, trackings, tabular, mono } = foundations.type;
  if (utility === "tabular-nums") return tabular.count;
  if (utility === "font-mono") return mono.count;
  const [stem, ...rest] = utility.split("-");
  const step = rest.join("-");
  if (stem === "text") return count(sizes, step);
  if (stem === "font") return count(weights, step);
  if (stem === "leading") return count(leadings, step);
  return count(trackings, step);
}

function readType(className: string) {
  const probe = document.createElement("div");
  probe.className = className;
  Object.assign(probe.style, { position: "absolute", visibility: "hidden", pointerEvents: "none" });
  document.body.append(probe);
  try {
    const { fontSize, lineHeight, fontWeight } = getComputedStyle(probe);
    return `${px(Number.parseFloat(fontSize))} / ${px(Number.parseFloat(lineHeight))} · ${fontWeight}`;
  } finally {
    probe.remove();
  }
}

function Pane({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return <figure className={roles.pane}>
    <figcaption>{label}</figcaption>
    {children}
    {note && <span className={roles.paneNote}>{note}</span>}
  </figure>;
}

export function TypeRoles() {
  const measured = useMemo(() => Object.fromEntries(typeRoles.map((role) =>
    [role.id, role.id === "numeric" ? "modifier" : readType(role.classes)])), []);
  return <section className={styles.section} aria-labelledby="type-roles">
    <h3 id="type-roles" className={styles.sectionTitle}>Roles<span className={styles.sectionCount}>Proposal</span></h3>
    <p className={roles.lede}>
      Seven named roles on the stock Tailwind scale. Each one names what most components already render and folds the outliers in; counts are the scanned occurrences below.
    </p>
    <table className={roles.roleTable}>
      <thead><tr><th scope="col">Role</th><th scope="col">Proposed</th><th scope="col">Today</th><th scope="col">Why</th></tr></thead>
      <tbody>
        {typeRoles.map((role) => <tr key={role.id}>
          <th scope="row">{role.name}</th>
          <td className={roles.stack}>
            <span className={`${roles.roleSpecimen} ${role.id === "numeric" ? "text-sm font-medium tabular-nums" : role.classes}`}>{SPECIMENS[role.id]}</span>
            <code>{role.classes}</code>
            <span className={styles.meta}>{measured[role.id]} · {role.history}</span>
          </td>
          <td>
            <div className={roles.today}>
              <span>{role.today(foundations.type)}</span>
              <ul aria-label="Scanned occurrences">
                {role.cites.map((utility) => <li key={utility} className={styles.meta}>{utility} ×{typeCount(utility)}</li>)}
              </ul>
            </div>
          </td>
          <td className={roles.why}>{role.rationale(foundations.type)}</td>
        </tr>)}
      </tbody>
    </table>
    <ul className={roles.notes}>
      <li>{typeNotes.weights}</li>
      <li>{typeNotes.families}</li>
    </ul>
    <div className={roles.compare}>
      <Pane label="Today" note="Owned components as shipped. The amount line mirrors the Home balance.">
        <TypeCard proposed={false} />
      </Pane>
      <Pane label="Proposed" note="Card title takes Heading, the amount sets leading-none, row metadata drops to text-xs.">
        <TypeCard proposed />
      </Pane>
    </div>
  </section>;
}

function TypeCard({ proposed }: { proposed: boolean }) {
  return <Card>
    <CardHeader>
      <CardTitle className={proposed ? "font-semibold" : undefined}>Savings</CardTitle>
      <CardDescription>Earns 4.1% on USDC</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-3">
      <div className={proposed ? "text-4xl font-semibold leading-none tabular-nums" : "text-4xl font-semibold tabular-nums"}>$1,284.50</div>
      <Item size="sm" variant="flush" className="px-0">
        <ItemContent>
          <ItemTitle>Deposit</ItemTitle>
          <ItemDescription lines={1} className={proposed ? "text-xs" : undefined}>Today, 9:41</ItemDescription>
        </ItemContent>
        <ItemContent position="value">
          <ItemTitle numeric>+$250.00</ItemTitle>
        </ItemContent>
      </Item>
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-sm">0x2211…7da9</span>
        <Badge variant="outline">Pending</Badge>
      </div>
    </CardContent>
  </Card>;
}

export function ShapeRoles() {
  const usage = foundations.radius.usage;
  const source = useMemo(() => {
    const defined = new Map(foundations.radius.scale.map(({ name, value }) => [name, value]));
    const steps = new Set([...shapeRoles.map(({ step }) => step), ...defined.keys(), ...usage.map(({ step }) => step)]);
    return Object.fromEntries([...steps].map((step) =>
      [step, step === "full" ? "calc(infinity * 1px)" : defined.get(step) ?? `var(--radius-${step})`]));
  }, [usage]);
  const radius = useMemo(() => measure(source), [source]);
  const scan = useMemo<ShapeScan>(() => ({
    usage,
    px: Object.fromEntries(Object.entries(radius).map(([step, value]) => [step, px(value)])),
    base: rootProperties(["radius"]).radius,
  }), [usage, radius]);
  return <section className={styles.section} aria-labelledby="shape-roles">
    <h3 id="shape-roles" className={styles.sectionTitle}>Shape roles<span className={styles.sectionCount}>Proposal</span></h3>
    <p className={roles.lede}>
      One radius per kind of surface, one step rounder at each level of nesting. Today lists the steps found in each role&apos;s component files.
    </p>
    <table className={roles.roleTable}>
      <thead><tr><th scope="col">Role</th><th scope="col">Proposed</th><th scope="col">Today</th><th scope="col">Why</th></tr></thead>
      <tbody>
        {shapeRoles.map((role) => {
          const found = filesUsing(usage, role.files);
          return <tr key={role.id}>
            <th scope="row" className={roles.stack}>
              <span className={roles.shapeBox} style={{ borderRadius: source[role.step] }} aria-hidden="true" />
              {role.name}
            </th>
            <td className={roles.stack}>
              <code>{`rounded-${role.step} · ${px(radius[role.step])}`}</code>
              <span className={styles.meta}>{role.surfaces}</span>
            </td>
            <td>
              <div className={roles.today}>
                <ul aria-label={`Radius steps in ${role.files.length} ${role.name} files`}>
                  {found.map(({ step, matched }) => <li key={step}>{`rounded-${step} in ${matched} of ${role.files.length}`}</li>)}
                </ul>
                <span className={styles.meta}>{`rounded-${role.step} ×${count(usage, role.step)} across components`}</span>
              </div>
            </td>
            <td className={roles.why}>{role.rationale(scan)}</td>
          </tr>;
        })}
      </tbody>
    </table>
    <ul className={roles.notes}>
      <li>{shapeNotes.base(scan)}</li>
      <li>{shapeNotes.inset(scan)}</li>
      <li>{shapeNotes.outlier(scan)}</li>
    </ul>
    <div className={roles.compare}>
      <Pane label="Today" note="Owned components as shipped; popup and sheet are surface samples with their components' classes.">
        <ShapeSample proposed={false} />
      </Pane>
      <Pane label="Proposed" note="Small Button and list items move to lg, the Item row to xl, Badge to full, popup to xl, sheet to 2xl.">
        <ShapeSample proposed />
      </Pane>
    </div>
  </section>;
}

function ShapeSample({ proposed }: { proposed: boolean }) {
  return <>
    <Card size="sm">
      <CardContent className="flex flex-col gap-3">
        <Item variant="outline" size="sm" className={proposed ? "rounded-xl" : undefined}>
          <ItemMedia variant="avatar">A</ItemMedia>
          <ItemContent>
            <ItemTitle>Alex</ItemTitle>
            <ItemDescription lines={1}>alex.base.eth</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Badge variant="outline" className={proposed ? "rounded-full" : undefined}>Pending</Badge>
          </ItemActions>
        </Item>
        <div className="flex items-center gap-2">
          <Input aria-label={proposed ? "Proposed amount" : "Current amount"} defaultValue="25.00" readOnly />
          <Button size="sm" variant="outline" className={proposed ? "rounded-lg" : undefined}>Max</Button>
          <Button>Send</Button>
        </div>
      </CardContent>
    </Card>
    <div className={roles.swatches}>
      <div className={proposed
        ? "flex flex-col rounded-xl bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10"
        : "flex flex-col rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10"}>
        <span className={proposed ? "rounded-lg bg-accent px-2 py-1.5 text-accent-foreground" : "rounded-md bg-accent px-2 py-1.5 text-accent-foreground"}>USDC</span>
        <span className="px-2 py-1.5">ETH</span>
      </div>
      <div className={proposed
        ? "flex h-24 flex-col items-center gap-3 rounded-t-2xl border border-b-0 bg-background pt-2 text-sm text-foreground shadow-lg"
        : "flex h-24 flex-col items-center gap-3 rounded-t-xl border border-b-0 bg-background pt-2 text-sm text-foreground shadow-lg"}>
        <span className="h-1 w-12 rounded-full bg-muted" aria-hidden="true" />
        <span className="font-semibold">Send</span>
      </div>
    </div>
  </>;
}
