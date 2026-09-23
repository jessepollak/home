export const noComputedStyleInComponentTests = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      rejected: "Component tests and stories must assert behavior, not computed styles; browser geometry belongs in Playwright.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        const direct = callee.type === "Identifier" && callee.name === "getComputedStyle";
        const member = callee.type === "MemberExpression"
          && (callee.object.type === "Identifier"
            && ["window", "globalThis"].includes(callee.object.name))
          && (callee.computed
            ? callee.property.type === "Literal" && callee.property.value === "getComputedStyle"
            : callee.property.type === "Identifier" && callee.property.name === "getComputedStyle");
        if (direct || member) context.report({ node, messageId: "rejected" });
      },
    };
  },
};
