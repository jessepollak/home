import type { Usage } from "./usage";

export type ShapeRole = {
  id: string;
  name: string;
  step: string;
  surfaces: string;
  files: string[];
  rationale: string;
};

const ui = (names: string[]) => names.map((name) => `components/ui/${name}.tsx`);

export const shapeRoles: ShapeRole[] = [
  {
    id: "control",
    name: "Control",
    step: "lg",
    surfaces: "Button, Input, Textarea, Select and Combobox triggers, Toggle, Input OTP, menu and select items",
    files: ui(["button", "input", "textarea", "select", "combobox", "toggle", "toggle-group", "input-otp", "input-group"]),
    rationale: "The base step itself. rounded-md is 3.2px against lg's 4px, a difference nobody sees at control size, so the small Button, Select and Toggle sizes stop switching steps.",
  },
  {
    id: "card",
    name: "Row / card",
    step: "xl",
    surfaces: "Card, standalone Item rows, Alert, Empty, support messages",
    files: ui(["card", "item", "alert", "empty", "support-message"]),
    rationale: "Card already uses xl. Item, Alert and Empty move up one step, so a container always reads one step rounder than the controls inside it.",
  },
  {
    id: "popup",
    name: "Popup",
    step: "xl",
    surfaces: "Popover, Select and Combobox lists, Toast",
    files: ui(["popover", "toast"]),
    rationale: "Same step as a card. A popup is told apart by elevation, not by shape: Popover and lists move up from lg, Toast down from 2xl.",
  },
  {
    id: "sheet",
    name: "Sheet",
    step: "2xl",
    surfaces: "Drawer, Dialog, the desktop money sheet",
    files: ui(["drawer", "dialog"]),
    rationale: "The largest surfaces take the largest step. On a phone only the leading edge rounds; Drawer and Dialog move up from xl.",
  },
  {
    id: "pill",
    name: "Pill / avatar",
    step: "full",
    surfaces: "Badge, Switch, Progress, rail and tab buttons, search field, avatars and status marks",
    files: ui(["badge", "switch", "progress", "rail-nav", "shell-search-surface", "status-step", "payout-mark", "pull-to-refresh"]),
    rationale: "Already the most common radius in components. Badge's rounded-4xl is 10.4px on a 22px chip, almost a pill; it becomes a true one.",
  },
];

export const shapeNotes = {
  base: "--radius stays 0.25rem. The problem is mixing, not the base: every step is a multiple of --radius, so moving it reshapes every surface at once and softens Home's deliberately crisp corners. Four steps (lg, xl, 2xl, full) carry every surface.",
  inset: "Marks nested inside a control (Input Group buttons, Kbd, Item images) step down to rounded-sm. rounded-xs, rounded-md and rounded-4xl retire.",
  outlier: "Prompt Input's rounded-3xl is Tailwind's stock 24px, off the --radius scale entirely. It is left unassigned for a decision rather than folded in.",
};

export function filesUsing(usage: Usage[], files: string[]) {
  return usage.flatMap((entry) => {
    const matched = entry.files.filter((file) => files.includes(file)).length;
    return matched ? [{ step: entry.step, matched }] : [];
  });
}

export type TypeRole = {
  id: string;
  name: string;
  classes: string;
  history: string;
  today: string;
  cites: string[];
  rationale: string;
};

export const typeRoles: TypeRole[] = [
  {
    id: "amount",
    name: "Amount",
    classes: "text-4xl font-semibold leading-none tabular-nums",
    history: "Home/Amount entry 48/48",
    today: "Home balance and Confirm summary render text-4xl semibold tabular; the amount field starts at text-5xl and fits down.",
    cites: ["font-semibold", "tabular-nums"],
    rationale: "Money is the only display-sized text. The entry field keeps text-5xl as its fit ceiling.",
  },
  {
    id: "heading",
    name: "Heading",
    classes: "text-base font-semibold",
    history: "Home/Heading 18/28 retires",
    today: "Six treatments: Dialog sm semibold, Drawer base semibold, Card base medium, Result lg semibold, Feature intro 2xl semibold, coverage popover 0.875rem semibold.",
    cites: ["text-base", "font-semibold"],
    rationale: "One heading per surface. text-base is the most common of today's six and is the Drawer title people see most; semibold is already five of six.",
  },
  {
    id: "body",
    name: "Body",
    classes: "text-sm",
    history: "Home/Small 14/20",
    today: "Card and Item descriptions, Popover, Dialog, Drawer and message text. Fields render text-base below md so iOS does not zoom on focus; that stays.",
    cites: ["text-sm", "font-normal"],
    rationale: "text-sm is the most used size in components by a wide margin; it already is the body.",
  },
  {
    id: "label",
    name: "Label",
    classes: "text-sm font-medium",
    history: "Home/Label 14/20 medium",
    today: "Button, Toggle, Item title and field Label already render text-sm medium.",
    cites: ["text-sm", "font-medium"],
    rationale: "font-medium is the most used weight; this names what controls and row titles already do.",
  },
  {
    id: "metadata",
    name: "Metadata",
    classes: "text-xs text-muted-foreground",
    history: "Home/Caption 12/16 · Home/Micro 12/16 medium",
    today: "Badge, small Button and Toggle, xs Item descriptions; three off-scale text-[0.8125rem] (13px) captions in the balance bar and coverage status.",
    cites: ["text-xs"],
    rationale: "The 13px captions fold into text-xs. Badges keep font-medium, which is Home/Micro.",
  },
  {
    id: "numeric",
    name: "Numeric",
    classes: "tabular-nums",
    history: "No Home/* style",
    today: "Item numeric titles, Progress, Input OTP, rail counts, balance bar, money ticker.",
    cites: ["tabular-nums"],
    rationale: "A modifier, not a size: any role showing an aligned or changing number adds it.",
  },
  {
    id: "mono",
    name: "Mono",
    classes: "font-mono text-sm",
    history: "Home/Mono sm 14/20 · Home/Mono and Mono tight retire",
    today: "Copyable Value and card details render font-mono text-sm; Home/Mono tight (12px, −0.3px) never reached code.",
    cites: ["font-mono"],
    rationale: "Addresses, hashes and code only, at body size so a copied value reads like the text around it.",
  },
];

export const typeNotes = {
  weights: "Three weights carry every role: normal, medium, semibold. font-bold appears only in Payout Mark brand marks, which are artwork, not type.",
  families: "System font stacks stay unchanged.",
};
