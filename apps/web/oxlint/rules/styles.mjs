import path from "node:path";
import { fileURLToPath } from "node:url";
import { designSystem } from "../policy/design-system.mjs";
import { decodeLetterEscapes, formControlHasAllowlist, hasSelectorFindings } from "../policy/has-selectors.mjs";
import { importantUtilityAllowlist } from "../policy/important-utilities.mjs";

const literalStyleMessage =
  "Use semantic theme tokens instead of hex/rgba, arbitrary-px, or raw palette colors in utility strings.";
const literalStylePattern = /(?:#[0-9a-fA-F]{3,8}|rgba?\(|(?:^|\s)(?:[a-z-]+:)*-?(?:rounded|text|size|w|h|min-w|max-w|min-h|max-h|p[trblxy]?|m[trblxy]?|gap|space-[xy]|inset(?:-[xy])?|top|right|bottom|left|ring|outline|border)-\[(?![^\]]*var\(--)(?=[^\]]*px)[^\]]+\]|(?:^|\s)(?:[a-z-]+:)*(?:bg|text|border|ring|outline|fill|stroke)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-|\/|\s|$))/;

function stringValue(node) {
  if ((node?.type === "Literal" || node?.type === "StringLiteral") && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateElement") return node.value.raw;
  return null;
}

function reportIfLiteral(context, node) {
  const value = stringValue(node);
  if (value !== null && literalStylePattern.test(value)) context.report({ node, messageId: "literal" });
}

const hasCache = new Map();
const importantCache = new Map();

function compiledFindings(token, cache, inspect) {
  if (!cache.has(token)) {
    const css = designSystem?.candidatesToCss([token])[0];
    cache.set(token, css == null ? [] : inspect(css));
  }
  return cache.get(token);
}

function relativeFile(filename) {
  return path.relative(fileURLToPath(new URL("../..", import.meta.url)), filename).replaceAll("\\", "/");
}

function utilityRule({ prefilter, cache, inspect, messageId, messages, allowed }) {
  return {
    meta: { type: "problem", schema: [], messages },
    create(context) {
      const file = relativeFile(context.filename);
      function check(node, value) {
        for (const token of new Set(value.split(/\s+/))) {
          if (!prefilter(token)) continue;
          const reported = new Set();
          for (const finding of compiledFindings(token, cache, inspect)) {
            const id = messageId(finding);
            if (allowed(file, token, finding) || reported.has(id)) continue;
            reported.add(id);
            context.report({ node, messageId: id, data: { token } });
          }
        }
      }
      return {
        Literal(node) { if (typeof node.value === "string") check(node, node.value); },
        StringLiteral(node) { if (typeof node.value === "string") check(node, node.value); },
        TemplateElement(node) { check(node, node.value.raw); },
      };
    },
  };
}

export const noDescendantHas = utilityRule({
  prefilter: (token) => decodeLetterEscapes(token).toLowerCase().includes("has"),
  cache: hasCache,
  inspect: hasSelectorFindings,
  messageId: (finding) => finding.kind,
  messages: {
    descendant: "Tailwind token '{{token}}' uses a non-child :has() selector; use direct-child form or the form-control policy.",
    root: "Tailwind token '{{token}}' anchors :has() on the document root.",
  },
  allowed: (file, _token, finding) => finding.kind === "descendant" && formControlHasAllowlist.has(file),
});

export const noImportantUtilities = utilityRule({
  prefilter: (token) => token.includes("!"),
  cache: importantCache,
  inspect: (css) => /!important\s*(?=;|})/i.test(css) ? [true] : [],
  messageId: () => "important",
  messages: { important: "Tailwind token '{{token}}' emits !important; use a structural or owned-variant fix." },
  allowed: (file, token) => importantUtilityAllowlist.some((entry) => entry.file === file && entry.token === token && entry.reason),
});

export const noLiteralUtilityStyles = {
  meta: { type: "problem", schema: [], messages: { literal: literalStyleMessage } },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier" || node.name.name !== "className" || !node.value) return;
        if (node.value.type === "JSXExpressionContainer") {
          const expression = node.value.expression;
          if (expression.type === "TemplateLiteral") {
            for (const quasi of expression.quasis) reportIfLiteral(context, quasi);
          } else reportIfLiteral(context, expression);
        } else reportIfLiteral(context, node.value);
      },
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || !["cn", "cva"].includes(node.callee.name)) return;
        for (const argument of node.arguments) {
          if (argument.type === "TemplateLiteral") {
            for (const quasi of argument.quasis) reportIfLiteral(context, quasi);
          } else reportIfLiteral(context, argument);
        }
      },
    };
  },
};
