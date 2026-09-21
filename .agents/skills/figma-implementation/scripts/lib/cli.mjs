// Shared CLI parsing for the figma-implementation scripts.
//
// Pure module: no browser, no filesystem, no network. Everything here is unit
// tested in `.agents/skills/figma-implementation/tests/cli.test.mjs`.
//
// Conventions used by every script in this skill:
//   --key value            string or boolean (a bare `--flag` parses as `true`)
//   --key=value            same, with the value attached
//   --key a --key b        repeatable keys collect into an array
//   positional args        collected into `args._`

/**
 * @param {string[]} argv
 * @param {{ repeatable?: string[] }} [options]
 * @returns {Record<string, string | true | string[]> & { _: string[] }}
 */
export function parseArgs(argv, { repeatable = [] } = {}) {
  /** @type {any} */
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith("--")) {
      args._.push(raw);
      continue;
    }
    const eq = raw.indexOf("=");
    let key;
    /** @type {string | true} */
    let value;
    if (eq !== -1) {
      key = raw.slice(2, eq);
      value = raw.slice(eq + 1);
    } else {
      key = raw.slice(2);
      const next = argv[i + 1];
      value = next === undefined || next.startsWith("--") ? true : argv[++i];
    }
    if (!key) throw new Error(`Invalid flag: ${raw}`);
    if (repeatable.includes(key)) {
      if (!Array.isArray(args[key])) args[key] = [];
      args[key].push(value);
    } else {
      args[key] = value;
    }
  }
  return args;
}

/** @param {Record<string, unknown>} args */
export function stringArg(args, key) {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

/** @param {Record<string, unknown>} args */
export function numberArg(args, key) {
  const value = stringArg(args, key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${key} expects a number, got: ${value}`);
  return parsed;
}

/** @param {Record<string, unknown>} args */
export function boolArg(args, key) {
  const value = args[key];
  return value === true || value === "true" || value === "1";
}

/** `--viewport 390x844` */
export function parseViewport(value, fallback = null) {
  if (value === undefined || value === true) return fallback;
  const match = /^(\d+)\s*x\s*(\d+)$/.exec(String(value).trim());
  if (!match) throw new Error(`--viewport expects WxH (for example 390x844), got: ${value}`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

/** `--crop x,y,w,h` and `--mask x,y,w,h`, both 1:1 in CSS pixels. */
export function parseBox(value) {
  if (value === undefined || value === true) return null;
  const parts = String(value)
    .split(",")
    .map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error(`expected x,y,w,h, got: ${value}`);
  }
  const [x, y, width, height] = parts;
  if (width <= 0 || height <= 0) throw new Error(`width and height must be positive, got: ${value}`);
  return { x, y, width, height };
}

/** @param {unknown} value */
export function parseBoxList(value) {
  if (value === undefined) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((entry, index) => {
    const box = parseBox(entry);
    if (!box) throw new Error(`mask[${index}] must be x,y,w,h`);
    return box;
  });
}

export function formatViewport(viewport) {
  return viewport ? `${viewport.width}x${viewport.height}` : "default";
}

/** Percentages are reported with three decimals so tiny diffs stay legible. */
export function roundPercent(value) {
  return Math.round(value * 1000) / 1000;
}
