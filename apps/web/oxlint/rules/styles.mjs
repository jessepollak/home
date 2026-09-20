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
