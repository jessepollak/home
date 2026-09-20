import { jsxColorExceptions } from "../policy/jsx-color-exceptions.mjs";

const message =
  "Use a semantic design token or owned CSS class instead of the raw JSX color '{{color}}'.";

// Paint attributes whose literal values should resolve to a token, not a hard-coded color.
const colorAttributes = new Set(["fill", "stroke", "color", "stopColor", "floodColor", "lightingColor"]);

// Non-color paint keywords and token/url references that are already semantic.
const safePaint = /^(?:none|currentcolor|inherit|transparent|context-fill|context-stroke)$/i;

function literalValue(node) {
  if ((node?.type === "Literal" || node?.type === "StringLiteral") && typeof node.value === "string") return node.value;
  if (node?.type === "JSXExpressionContainer") return literalValue(node.expression);
  return null;
}

export const noLiteralJsxColors = {
  meta: { type: "problem", schema: [], messages: { color: message } },
  create(context) {
    const filename = String(context.filename ?? "").replaceAll("\\", "/");
    const exception = [...jsxColorExceptions.entries()]
      .find(([file]) => filename === file || filename.endsWith(`/${file}`))?.[1];

    return {
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier" || !colorAttributes.has(node.name.name) || !node.value) return;
        const value = literalValue(node.value);
        if (value === null) return;
        const paint = value.trim();
        if (!paint || paint.includes("var(") || /^url\(/i.test(paint) || safePaint.test(paint)) return;
        if (exception?.has(paint.toLowerCase())) return;
        context.report({ node, messageId: "color", data: { color: paint } });
      },
    };
  },
};
