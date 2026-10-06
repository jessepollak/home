import type { typeUsage, Usage } from "./usage";

export type ShapeScan = { usage: Usage[]; px: Record<string, string>; base: string };
export type TypeScan = ReturnType<typeof typeUsage>;

export type ShapeRole = {
  id: string;
  name: string;
  step: string;
  surfaces: string;
  files: string[];
  rationale: (scan: ShapeScan) => string;
};

const byCount = (usage: Usage[]) => [...usage].sort((left, right) => right.count - left.count);
const basename = (path: string) => path.split("/").at(-1)!.replace(/\.tsx$/, "");

function standing(usage: Usage[], step: string, prefix: string, noun: string): string {
  const [top, next] = byCount(usage);
  const own = usage.find((entry) => entry.step === step)?.count ?? 0;
  if (!top) return `${prefix}${step} has no scanned uses`;
  if (top.step !== step) return `${prefix}${step} is used ×${own}, behind ${prefix}${top.step} at ×${top.count}`;
  return next ? `${prefix}${step} is the most used ${noun} in components, ×${own} against ×${next.count} for ${prefix}${next.step}`
    : `${prefix}${step} is the only ${noun} in components`;
}

const ui = (names: string[]) => names.map((name) => `components/ui/${name}.tsx`);

export const shapeRoles: ShapeRole[] = [
  {
    id: "control",
    name: "Control",
    step: "lg",
    surfaces: "Button, Input, Textarea, Select and Combobox triggers, Toggle, Input OTP, menu and select items",
    files: ui(["button", "input", "textarea", "select", "combobox", "toggle", "toggle-group", "input-otp", "input-group"]),
    rationale: ({ px }) => `The base step itself. rounded-md is ${px.md} against lg's ${px.lg}, a difference nobody sees at control size, so the small Button, Select and Toggle sizes stop switching steps.`,
  },
  {
    id: "card",
    name: "Row / card",
    step: "xl",
    surfaces: "Card, standalone Item rows, Alert, Empty, support messages",
    files: ui(["card", "item", "alert", "empty", "support-message"]),
    rationale: () => "Card already uses xl. Item, Alert and Empty move up one step, so a container always reads one step rounder than the controls inside it.",
  },
  {
    id: "popup",
    name: "Popup",
    step: "xl",
    surfaces: "Popover, Toast",
    files: ui(["popover", "toast"]),
    rationale: () => "Same step as a card. A popup is told apart by elevation, not by shape: Popover moves up from lg, Toast down from 2xl. Select and Combobox lists follow Popover; their files are counted under Control.",
  },
  {
    id: "sheet",
    name: "Sheet",
    step: "2xl",
    surfaces: "Drawer, Dialog, the desktop money sheet",
    files: ui(["drawer", "dialog"]),
    rationale: () => "The largest surfaces take the largest step. On a phone only the leading edge rounds; Drawer and Dialog move up from xl.",
  },
  {
    id: "pill",
    name: "Pill / avatar",
    step: "full",
    surfaces: "Badge, Switch, Progress, rail and tab buttons, search field, avatars and status marks",
    files: ui(["badge", "switch", "progress", "rail-nav", "shell-search-surface", "status-step", "payout-mark", "pull-to-refresh"]),
    rationale: ({ usage, px }) => `${standing(usage, "full", "rounded-", "radius")}. Badge's rounded-4xl is ${px["4xl"]} on its h-5.5 chip, almost a pill; it becomes a true one.`,
  },
];

const roleSteps = [...new Set(shapeRoles.map(({ step }) => step))];
const INSET_STEP = "sm";
const OUTLIER_STEP = "3xl";
const list = (items: string[]) => items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : items.join("");

export const shapeNotes = {
  base: ({ base }: ShapeScan) => `--radius stays ${base || "unchanged"}. The problem is mixing, not the base: every step is a multiple of --radius, so moving it reshapes every surface at once and softens Home's deliberately crisp corners. Steps ${list(roleSteps)} carry every surface.`,
  inset: ({ usage }: ShapeScan) => {
    const retiring = usage.map(({ step }) => step).filter((step) => ![...roleSteps, INSET_STEP, OUTLIER_STEP].includes(step));
    return `Marks nested inside a control (Input Group buttons, Kbd, Item images) step down to rounded-${INSET_STEP}.${retiring.length ? ` ${list(retiring.map((step) => `rounded-${step}`))} retire.` : ""}`;
  },
  outlier: ({ px }: ShapeScan) => `Prompt Input's rounded-${OUTLIER_STEP} is Tailwind's stock ${px[OUTLIER_STEP]}, off the --radius scale entirely. It is left unassigned for a decision rather than folded in.`,
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
  today: (scan: TypeScan) => string;
  cites: string[];
  rationale: (scan: TypeScan) => string;
};

const HEADINGS = [
  { surface: "Dialog", size: "sm", weight: "semibold" },
  { surface: "Drawer", size: "base", weight: "semibold" },
  { surface: "Card", size: "base", weight: "medium" },
  { surface: "Result", size: "lg", weight: "semibold" },
  { surface: "Feature intro", size: "2xl", weight: "semibold" },
  { surface: "coverage popover", size: "0.875rem", weight: "semibold" },
];
const pixels = (step: string) => Number.parseFloat(step) * (step.endsWith("rem") ? 16 : 1);
const captionSizes = ({ arbitrarySizes }: TypeScan) => arbitrarySizes.filter(({ step }) => pixels(step) < 14);
const semiboldHeadings = HEADINGS.filter(({ weight }) => weight === "semibold").length;

export const typeRoles: TypeRole[] = [
  {
    id: "amount",
    name: "Amount",
    classes: "text-4xl font-semibold leading-none tabular-nums",
    history: "Home/Amount entry 48/48",
    today: () => "In client/ screens, the Home balance and Confirm summary render text-4xl semibold tabular; the amount field starts at text-5xl and fits down.",
    cites: ["font-semibold", "tabular-nums"],
    rationale: () => "Money is the only display-sized text. The entry field keeps text-5xl as its fit ceiling.",
  },
  {
    id: "heading",
    name: "Heading",
    classes: "text-base font-semibold",
    history: "Home/Heading 18/28 retires",
    today: () => `Each title sets its own: ${HEADINGS.map(({ surface, size, weight }) => `${surface} ${size} ${weight}`).join(", ")}.`,
    cites: ["text-base", "font-semibold"],
    rationale: () => `One heading per surface. text-base is the Drawer title people see most; ${semiboldHeadings} of the ${HEADINGS.length} titles are already semibold.`,
  },
  {
    id: "body",
    name: "Body",
    classes: "text-sm",
    history: "Home/Small 14/20",
    today: () => "Card and Item descriptions, Popover, Dialog, Drawer and message text. Fields render text-base below md so iOS does not zoom on focus; that stays.",
    cites: ["text-sm", "font-normal"],
    rationale: ({ sizes }) => `${standing(sizes, "sm", "text-", "size")}; it already is the body.`,
  },
  {
    id: "label",
    name: "Label",
    classes: "text-sm font-medium",
    history: "Home/Label 14/20 medium",
    today: () => "Button, Toggle, Item title and field Label already render text-sm medium.",
    cites: ["text-sm", "font-medium"],
    rationale: ({ weights }) => `${standing(weights, "medium", "font-", "weight")}; this names what controls and row titles already do.`,
  },
  {
    id: "metadata",
    name: "Metadata",
    classes: "text-xs text-muted-foreground",
    history: "Home/Caption 12/16 · Home/Micro 12/16 medium",
    today: (scan) => `Badge, small Button and Toggle, xs Item descriptions; ${captionSizes(scan).length
      ? captionSizes(scan).map(({ step, count, files }) => `off-scale text-[${step}] captions ×${count} in ${files.map(basename).join(", ")}`).join("; ")
      : "no off-scale caption sizes"}.`,
    cites: ["text-xs"],
    rationale: () => "Off-scale captions fold into text-xs. Badges keep font-medium, which is Home/Micro.",
  },
  {
    id: "numeric",
    name: "Numeric",
    classes: "tabular-nums",
    history: "No Home/* style",
    today: () => "Item numeric titles, Progress, Input OTP, rail counts, balance bar, money ticker.",
    cites: ["tabular-nums"],
    rationale: () => "A modifier, not a size: any role showing an aligned or changing number adds it.",
  },
  {
    id: "mono",
    name: "Mono",
    classes: "font-mono text-sm",
    history: "Home/Mono sm 14/20 · Home/Mono and Mono tight retire",
    today: () => "Copyable Value and card details render font-mono text-sm; Home/Mono tight (12px, −0.3px) never reached code.",
    cites: ["font-mono"],
    rationale: () => "Addresses, hashes and code only, at body size so a copied value reads like the text around it.",
  },
];

export const typeNotes = {
  weights: "Three weights carry every role: normal, medium, semibold. font-bold appears only in Payout Mark brand marks, which are artwork, not type.",
  families: "System font stacks stay unchanged.",
};
