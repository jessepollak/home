const messages = {
  locale: "Use shared/formatting for locale-aware number and date presentation.",
  numeric: "Use shared/formatting for numeric presentation.",
};

function memberName(node) {
  if (node?.type !== "MemberExpression") return null;
  if (!node.computed && node.property.type === "Identifier") return node.property.name;
  if (node.computed && (node.property.type === "Literal" || node.property.type === "StringLiteral")) return node.property.value;
  return null;
}

export const noLocalFormatting = {
  meta: { type: "problem", schema: [], messages },
  create(context) {
    return {
      NewExpression(node) {
        const callee = node.callee;
        if (callee.type === "MemberExpression" && !callee.computed
          && callee.object.type === "Identifier" && callee.object.name === "Intl"
          && callee.property.type === "Identifier"
          && ["NumberFormat", "DateTimeFormat"].includes(callee.property.name)) {
          context.report({ node, messageId: "locale" });
        }
      },
      CallExpression(node) {
        const name = memberName(node.callee);
        if (["toLocaleString", "toLocaleDateString", "toLocaleTimeString"].includes(name)) {
          context.report({ node, messageId: "locale" });
        } else if (name === "toFixed") {
          context.report({ node, messageId: "numeric" });
        }
      },
    };
  },
};
