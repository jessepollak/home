import { applyBodies } from "./css-apply.mjs";
import { hasSelectorFindings } from "../../apps/web/oxlint/policy/has-selectors.mjs";

const LAYERS = ["app/", "client/", "components/"];
const PRODUCT_EXCLUSION = /(?:^|\/)explorations\/|\.stories\.(?:module\.)?css$/;

export const importantAllowlist = [
  {
    file: "app/globals.css",
    text: 'a[href], button:not(:disabled), [role="button"]:not([aria-disabled="true"]), [role="option"]:not([aria-disabled="true"]), [role="radio"]:not([aria-disabled="true"]), summary { cursor: pointer !important; }',
    reason: "Interactive cursors must override cursor-default utilities in shipped shadcn components.",
  },
];

function decodeIdentifier(value) {
  return value.replace(/\\(?:([a-f\d]{1,6})(?:\r\n|[ \t\n\r\f])?|([^\r\n\f]))/gi, (_match, hex, escaped) =>
    hex ? String.fromCodePoint(Math.min(parseInt(hex, 16) || 0xfffd, 0x10ffff)) : escaped);
}

function importantOffsets(css) {
  const offsets = [];
  for (let i = 0; i < css.length; i++) {
    if (css[i] === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end < 0) break;
      i = end + 1;
    } else if (css[i] === '"' || css[i] === "'") {
      const quote = css[i];
      for (i++; i < css.length; i++) {
        if (css[i] === "\\") i++;
        else if (css[i] === quote) break;
      }
    } else if (css[i] === "!") {
      const match = /^!\s*(?:\/\*[\s\S]*?\*\/\s*)*((?:[\w-]|\\(?:[a-f\d]{1,6}(?:\r\n|[ \t\n\r\f])?|[^\r\n\f]))+)/i.exec(css.slice(i));
      if (match && decodeIdentifier(match[1]).toLowerCase() === "important") offsets.push(i);
    }
  }
  return offsets;
}

// `@apply` carries Tailwind's important modifier in its token list even though the
// file text never spells `!important`; bracket contents are excluded so a value
// such as `content-['!important']` is not mistaken for the modifier.
function applyImportantOffsets(css) {
  const offsets = [];
  for (const { maskedBody, start } of applyBodies(css)) {
    for (const token of maskedBody.matchAll(/\S+/g)) {
      const plain = token[0].replace(/\[[^\]]*\]/g, "");
      if (plain.endsWith("!") || plain.split(":").some((segment) => segment.startsWith("!"))) offsets.push(start + token.index);
    }
  }
  return offsets;
}


export function collectSourceCssFindings(files) {
  const findings = [];
  for (const { path, content } of files) {
    if (!path.endsWith(".css") || !LAYERS.some((layer) => path.startsWith(layer))) continue;
    for (const finding of hasSelectorFindings(content)) {
      if (finding.kind === "root") findings.push({ path, kind: "root", selector: finding.selector });
    }
    if (PRODUCT_EXCLUSION.test(path)) continue;
    const used = new Set();
    for (const offset of [...new Set([...importantOffsets(content), ...applyImportantOffsets(content)])].sort((left, right) => left - right)) {
      const allow = importantAllowlist.find((entry) => {
        if (entry.file !== path || used.has(entry)) return false;
        const at = content.indexOf(entry.text);
        return at >= 0 && offset >= at && offset < at + entry.text.length;
      });
      if (allow) { used.add(allow); continue; }
      findings.push({ path, kind: "important", line: content.slice(0, offset).split("\n").length });
    }
  }
  return findings;
}
