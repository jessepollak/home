import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fileKey = "ixgttt6IurKynsvMJpLYDC";
const cssUrl = new URL("../app/globals.css", import.meta.url);
const source = "apps/web/app/globals.css";
const script = "apps/web/scripts/figma-variables.mjs";

function topLevelBlocks(css) {
  const blocks = [];
  const input = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (let position = 0; position < input.length;) {
    const open = input.indexOf("{", position);
    if (open === -1) break;
    const selector = input.slice(position, open).split(";").at(-1).trim();
    let depth = 1;
    let close = open + 1;
    while (depth && close < input.length) {
      if (input[close] === "{") depth++;
      if (input[close] === "}") depth--;
      close++;
    }
    if (depth) throw new Error(`Unclosed CSS block: ${selector}`);
    blocks.push({ selector, body: input.slice(open + 1, close - 1) });
    position = close;
  }
  return blocks;
}

function declarations(body) {
  return Object.fromEntries(body.split(";").map((entry) => {
    const colon = entry.indexOf(":");
    return colon < 0 ? null : [entry.slice(0, colon).trim(), entry.slice(colon + 1).trim()];
  }).filter((entry) => entry?.[0].startsWith("--")));
}

function lengthInPx(value, root) {
  const reference = value.match(/^var\((--[\w-]+)\)$/);
  if (reference) {
    if (!root[reference[1]]) throw new Error(`Undefined CSS length: ${reference[1]}`);
    return lengthInPx(root[reference[1]], root);
  }
  const calc = value.match(/^calc\(var\((--[\w-]+)\)\s*\*\s*(-?(?:\d*\.)?\d+)\)$/);
  if (calc) return lengthInPx(`var(${calc[1]})`, root) * Number(calc[2]);
  const length = value.match(/^(-?(?:\d*\.)?\d+)(px|rem)$/);
  if (length) return Number(length[1]) * (length[2] === "rem" ? 16 : 1);
  throw new Error(`Unsupported CSS length: ${value}`);
}

const clamp = (n) => Math.max(0, Math.min(1, n));
const gamma = (n) => clamp(n <= 0.0031308 ? 12.92 * n : 1.055 * n ** (1 / 2.4) - 0.055);

export function colorToFigma(value) {
  const hex = value.match(/^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((x) => x + x).join("") : hex[1];
    const channels = digits.match(/../g).map((x) => parseInt(x, 16) / 255);
    return { r: channels[0], g: channels[1], b: channels[2], a: channels[3] ?? 1 };
  }
  const ok = value.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+(-?[\d.]+)(?:\s*\/\s*([\d.]+)(%)?)?\s*\)$/i);
  if (ok) {
    const l = Number(ok[1]), c = Number(ok[2]), h = Number(ok[3]) * Math.PI / 180;
    const a = c * Math.cos(h), b = c * Math.sin(h);
    const x = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const y = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const z = (l - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    return {
      r: gamma(4.0767416621 * x - 3.3077115913 * y + 0.2309699292 * z),
      g: gamma(-1.2684380046 * x + 2.6097574011 * y - 0.3413193965 * z),
      b: gamma(-0.0041960863 * x - 0.7034186147 * y + 1.7076147010 * z),
      a: ok[4] ? clamp(Number(ok[4]) / (ok[5] ? 100 : 1)) : 1,
    };
  }
  const rgb = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%)?)?\s*\)$/i);
  if (rgb) return {
    r: clamp(Number(rgb[1]) / 255), g: clamp(Number(rgb[2]) / 255), b: clamp(Number(rgb[3]) / 255),
    a: rgb[4] ? clamp(Number(rgb[4]) / (rgb[5] ? 100 : 1)) : 1,
  };
  throw new Error(`Unsupported CSS color: ${value}`);
}

export function parseCss(css) {
  const blocks = topLevelBlocks(css);
  const theme = Object.assign({}, ...blocks.filter((block) => block.selector === "@theme inline").map((block) => declarations(block.body)));
  const root = Object.assign({}, ...blocks.filter((block) => block.selector === ":root").map((block) => declarations(block.body)));
  const darkBlocks = blocks.filter((block) => block.selector === ".dark");
  const dark = { ...root, ...Object.assign({}, ...darkBlocks.map((block) => declarations(block.body))) };
  const hasDark = darkBlocks.length > 0;
  const tokens = [];
  const skippedFonts = [];
  for (const [cssName, expression] of Object.entries(theme)) {
    if (cssName.startsWith("--font-")) {
      skippedFonts.push({ cssName, reason: "Figma uses SF Pro stand-ins bound to font/sans" });
      continue;
    }
    let name, reference, resolvedType, light, darkValue, scopes;
    if (cssName.startsWith("--color-")) {
      const match = expression.match(/^var\((--[\w-]+)\)$/);
      if (!match) throw new Error(`Unsupported color mapping: ${cssName}: ${expression}`);
      name = `color/${cssName.slice(8)}`;
      reference = match[1];
      resolvedType = "COLOR";
      scopes = ["ALL_FILLS", "STROKE_COLOR", "EFFECT_COLOR"];
      if (!root[reference]) throw new Error(`Missing light color: ${reference}`);
      light = colorToFigma(root[reference]);
      darkValue = colorToFigma(dark[reference]);
    } else if (cssName.startsWith("--radius-") || cssName.startsWith("--spacing-")) {
      name = `${cssName.startsWith("--radius-") ? "radius" : "space"}/${cssName.slice(cssName.indexOf("-", 2) + 1)}`;
      reference = cssName;
      resolvedType = "FLOAT";
      scopes = name.startsWith("radius/") ? ["CORNER_RADIUS"] : ["GAP", "WIDTH_HEIGHT"];
      light = lengthInPx(expression, root);
      darkValue = light;
    } else continue;
    tokens.push({ name, cssName, cssReference: `var(${reference})`, resolvedType, scopes, light, dark: darkValue });
  }
  return { tokens, hasDark, skippedFonts, notDefined: ["font sizes", "font weights", "line heights"] };
}

export async function loadCssTokens() {
  return parseCss(await readFile(cssUrl, "utf8"));
}

function different(before, after, type) {
  if (type === "FLOAT") return typeof before !== "number" || Math.abs(before - after) > 0.001;
  return !before || ["r", "g", "b", "a"].some((key) =>
    typeof before[key] !== "number" || Math.abs(before[key] - after[key]) > (key === "a" ? 0.005 : 0.5 / 255));
}

export function buildPlan(parsed, snapshot = { meta: { variableCollections: {}, variables: {} } }) {
  const collections = Object.values(snapshot.meta?.variableCollections ?? {}).filter((item) => !item.remote);
  const collectionById = new Map(collections.map((item) => [item.id, item]));
  const variables = Object.values(snapshot.meta?.variables ?? {}).filter((item) => !item.remote && collectionById.has(item.variableCollectionId));
  const tokenCollection = collections.find((item) => item.name === "Home tokens");
  const spaceCounts = new Map(collections.map((item) => [item.id, variables.filter((variable) => variable.variableCollectionId === item.id && variable.name.startsWith("space/")).length]));
  const spaceCollection = collections.reduce((best, item) => spaceCounts.get(item.id) > (best ? spaceCounts.get(best.id) : 0) ? item : best, null);
  const plan = { collections: [], modes: [], creates: [], updates: [], variableUpdates: [], unchanged: 0, skippedProposed: [], skippedAliases: [], figmaOnly: [], unmatched: [], skippedFonts: parsed.skippedFonts, notDefined: parsed.notDefined };
  let home = tokenCollection;
  const usedIds = new Set();
  function ensureHome() {
    if (!home) {
      home = { id: "temp:home-tokens", name: "Home tokens", modes: [{ modeId: "temp:light", name: "Light" }] };
      plan.collections.push({ id: home.id, initialModeId: "temp:light", name: home.name });
      plan.modes.push({ id: "temp:light", variableCollectionId: home.id, name: "Light", action: "UPDATE" });
    }
    if (parsed.hasDark && !home.modes.some((mode) => mode.name === "Dark")) {
      home = { ...home, modes: [...home.modes, { modeId: "temp:dark", name: "Dark" }] };
      plan.modes.push({ id: "temp:dark", variableCollectionId: home.id, name: "Dark", action: "CREATE" });
    }
    collectionById.set(home.id, home);
    return home;
  }
  if (tokenCollection) ensureHome();
  for (const token of parsed.tokens) {
    const variable = variables.find((item) => !usedIds.has(item.id) && item.codeSyntax?.WEB === token.cssReference) ??
      variables.find((item) => !usedIds.has(item.id) && item.name === token.name);
    if (variable) usedIds.add(variable.id);
    if (variable && /\bPROPOSED\b/.test(variable.description ?? "")) {
      plan.skippedProposed.push({ name: variable.name, id: variable.id, cssReference: token.cssReference, code: { light: token.light, dark: token.dark }, figma: variable.valuesByMode });
      continue;
    }
    if (variable && variable.resolvedType !== token.resolvedType) throw new Error(`Type mismatch for ${variable.name}: ${variable.resolvedType} vs ${token.resolvedType}`);
    const collection = variable ? collectionById.get(variable.variableCollectionId) : token.name.startsWith("space/") && spaceCollection ? spaceCollection : ensureHome();
    if (!variable) {
      const id = `temp:variable-${plan.creates.length}`;
      plan.creates.push({ ...token, id, variableCollectionId: collection.id, collectionName: collection.name, description: `\`${token.cssReference.slice(4, -1)}\` — synced from ${source} by ${script}` });
    }
    let changed = false;
    if (variable && !variable.codeSyntax?.WEB) {
      plan.variableUpdates.push({ id: variable.id, name: variable.name, codeSyntax: { WEB: token.cssReference } });
      changed = true;
    }
    for (const mode of collection.modes) {
      const after = mode.name === "Dark" ? token.dark : token.light;
      const before = variable?.valuesByMode?.[mode.modeId];
      if (before?.type === "VARIABLE_ALIAS") {
        plan.skippedAliases.push({ name: variable.name, mode: mode.name });
      } else if (!variable || different(before, after, token.resolvedType)) {
        plan.updates.push({ variableId: variable?.id ?? plan.creates.at(-1).id, name: variable?.name ?? token.name, variableCollectionId: collection.id, modeId: mode.modeId, mode: mode.name, before: before ?? null, after });
        changed = true;
      }
    }
    if (!changed) plan.unchanged++;
  }
  const defined = new Set(parsed.tokens.map((token) => token.cssReference));
  for (const variable of variables) {
    const reference = variable.codeSyntax?.WEB;
    if (usedIds.has(variable.id)) continue;
    if (/^var\(--[\w-]+\)$/.test(reference ?? "")) {
      if (!defined.has(reference) && !parsed.skippedFonts.some((font) => `var(${font.cssName})` === reference)) {
        plan.figmaOnly.push({ name: variable.name, id: variable.id, cssReference: reference });
      }
    } else {
      plan.unmatched.push({ name: variable.name, id: variable.id, codeSyntax: reference ?? null });
    }
  }
  return plan;
}

export function buildPayload(plan) {
  return {
    variableCollections: plan.collections.map(({ id, initialModeId, name }) => ({ action: "CREATE", id, initialModeId, name })),
    variableModes: plan.modes,
    variables: [
      ...plan.creates.map(({ id, name, variableCollectionId, resolvedType, description, scopes, cssReference }) =>
        ({ action: "CREATE", id, name, variableCollectionId, resolvedType, description, scopes, codeSyntax: { WEB: cssReference } })),
      ...plan.variableUpdates.map(({ id, codeSyntax }) => ({ action: "UPDATE", id, codeSyntax })),
    ],
    variableModeValues: plan.updates.map(({ variableId, modeId, after }) => ({ variableId, modeId, value: after })),
  };
}

async function request(method, token, body) {
  const response = await fetch(`https://api.figma.com/v1/files/${fileKey}/variables${method === "GET" ? "/local" : ""}`, {
    method, headers: { "X-Figma-Token": token, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(`Figma HTTP ${response.status}: ${result.message ?? result.error ?? "Request failed"}`);
  }
  return response.json();
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !["--dry-run", "--json"].includes(arg))) throw new Error("Usage: figma-variables.mjs [--dry-run] [--json]");
  const dryRun = args.includes("--dry-run");
  const token = process.env.FIGMA_ACCESS_TOKEN || undefined;
  if (!token && !dryRun) throw new Error("FIGMA_ACCESS_TOKEN is required for a write run; use --dry-run for a plan (live diff with a token, empty-file plan without)");
  const parsed = await loadCssTokens();
  const plan = buildPlan(parsed, token ? await request("GET", token) : undefined);
  if (!dryRun) {
    const payload = buildPayload(plan);
    if (payload.variableCollections.length || payload.variableModes.length || payload.variables.length || payload.variableModeValues.length) await request("POST", token, payload);
  }
  console.log(args.includes("--json") ? JSON.stringify(plan, null, 2) : formatPlan(plan));
}

function displayValue(value) {
  if (value == null) return "missing";
  if (typeof value === "number") return String(Number(value.toFixed(3)));
  if (value.type === "VARIABLE_ALIAS") return `alias ${value.id}`;
  const channel = (n) => Math.round(n * 255);
  if (value.a < 1) return `rgba(${channel(value.r)},${channel(value.g)},${channel(value.b)},${Number(value.a.toFixed(2))})`;
  return `#${[value.r, value.g, value.b].map((n) => channel(n).toString(16).padStart(2, "0")).join("")}`;
}

export function formatPlan(plan) {
  const lines = [`Figma variables: ${plan.creates.length} creates, ${plan.updates.length} value updates, ${plan.variableUpdates.length} syntax updates, ${plan.unchanged} unchanged, ${plan.skippedProposed.length} proposed skipped, ${plan.skippedAliases.length} aliases skipped, ${plan.figmaOnly.length} Figma-only, ${plan.unmatched.length} unmatched`];
  for (const item of plan.collections) lines.push(`CREATE COLLECTION ${item.name}`);
  for (const item of plan.modes) lines.push(`${item.action} MODE ${item.name}`);
  for (const item of plan.creates) {
    const values = plan.updates.filter((update) => update.variableId === item.id).map((update) => `${update.mode} ${displayValue(update.after)}`).join("  ");
    lines.push(`CREATE ${item.name} → ${item.collectionName}  ${values}`);
  }
  const created = new Set(plan.creates.map((item) => item.id));
  for (const item of plan.updates.filter((update) => !created.has(update.variableId))) lines.push(`UPDATE ${item.name}  ${item.mode} ${displayValue(item.before)} → ${displayValue(item.after)}`);
  for (const item of plan.variableUpdates) lines.push(`UPDATE ${item.name}  WEB ${item.codeSyntax.WEB}`);
  for (const item of plan.skippedProposed) lines.push(`SKIP PROPOSED ${item.name}  code ${displayValue(item.code.light)} · Figma ${displayValue(Object.values(item.figma)[0])}`);
  for (const item of plan.skippedAliases) lines.push(`SKIP ALIAS ${item.name}  ${item.mode}`);
  for (const item of plan.figmaOnly) lines.push(`FIGMA-ONLY ${item.name}`);
  for (const item of plan.unmatched) lines.push(`UNMATCHED ${item.name}${item.codeSyntax ? `  ${item.codeSyntax}` : ""}`);
  for (const item of plan.skippedFonts) lines.push(`SKIP FONT ${item.cssName}  ${item.reason}`);
  lines.push(`Not defined in CSS: ${plan.notDefined.join(", ")}`);
  return lines.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
