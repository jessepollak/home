import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { foundations } from "./model";
import { measure, rootProperties } from "./probe";
import { filesUsing, shapeNotes, shapeRoles, typeNotes, typeRoles, type ShapeScan } from "./roles";
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

export function TypeRoles() {
  const measured = useMemo(() => Object.fromEntries(typeRoles.map((role) =>
    [role.id, role.id === "numeric" ? "modifier" : readType(role.classes)])), []);
  return <section className={styles.section} aria-labelledby="type-roles">
    <h3 id="type-roles" className={styles.sectionTitle}>Roles</h3>
    <p className={roles.lede}>
      Seven adopted roles on the stock Tailwind scale. Owned components use these roles; counts are the scanned occurrences below.
    </p>
    <table className={roles.roleTable}>
      <thead><tr><th scope="col">Role</th><th scope="col">Contract</th><th scope="col">Usage</th><th scope="col">Why</th></tr></thead>
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
    <figure className={roles.sample}>
      <figcaption>Owned components · Heading, Amount, Label, Metadata and Mono</figcaption>
      <TypeCard />
    </figure>
  </section>;
}

function TypeCard() {
  return <Card>
    <CardHeader>
      <CardTitle>Savings</CardTitle>
      <CardDescription>Earns 4.1% on USDC</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-3">
      <div className="text-4xl font-semibold leading-none tabular-nums">$1,284.50</div>
      <Item size="sm" variant="flush" className="px-0">
        <ItemContent>
          <ItemTitle>Deposit</ItemTitle>
          <ItemDescription lines={1} size="xs">Today, 9:41</ItemDescription>
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
    <h3 id="shape-roles" className={styles.sectionTitle}>Shape roles</h3>
    <p className={roles.lede}>
      One radius per kind of surface, one step rounder at each level of nesting. Scanned usage lists the steps found in each role&apos;s component files.
    </p>
    <table className={roles.roleTable}>
      <thead><tr><th scope="col">Role</th><th scope="col">Contract</th><th scope="col">Scanned usage</th><th scope="col">Why</th></tr></thead>
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
      <li>{shapeNotes.inset()}</li>
      <li>{shapeNotes.outlier(scan)}</li>
    </ul>
    <figure className={roles.sample}>
      <figcaption>Owned components · Row / card, Control and Pill / avatar</figcaption>
      <ShapeSample />
    </figure>
  </section>;
}

function ShapeSample() {
  return <Card size="sm">
      <CardContent className="flex flex-col gap-3">
        <Item variant="outline" size="sm">
          <ItemMedia variant="avatar">A</ItemMedia>
          <ItemContent>
            <ItemTitle>Alex</ItemTitle>
            <ItemDescription lines={1}>alex.base.eth</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Badge variant="outline">Pending</Badge>
          </ItemActions>
        </Item>
        <div className="flex items-center gap-2">
          <Input aria-label="Amount" defaultValue="25.00" readOnly />
          <Button size="sm" variant="outline">Max</Button>
          <Button>Send</Button>
        </div>
      </CardContent>
    </Card>;
}
