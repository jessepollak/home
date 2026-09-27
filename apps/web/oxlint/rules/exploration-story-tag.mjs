function unwrap(node) {
  while (node && ["TSSatisfiesExpression", "TSAsExpression", "TSNonNullExpression", "TSInstantiationExpression"].includes(node.type)) node = node.expression;
  return node;
}

function hasExplorationTag(node) {
  const meta = unwrap(node);
  if (meta?.type !== "ObjectExpression") return false;
  const tags = meta.properties.find((property) => property.type === "Property"
    && !property.computed && (property.key.name ?? property.key.value) === "tags");
  const value = unwrap(tags?.value);
  return value?.type === "ArrayExpression" && value.elements.some((element) => element?.type === "Literal" && element.value === "exploration");
}

export const explorationStoryTag = {
  meta: {
    type: "problem",
    schema: [],
    messages: { missing: "Exploration story default meta must include tags: [\"exploration\"]." },
  },
  create(context) {
    const bindings = new Map();
    const defaults = [];
    return {
      VariableDeclarator(node) {
        if (node.id.type === "Identifier") bindings.set(node.id.name, node.init);
      },
      ExportDefaultDeclaration(node) { defaults.push(node); },
      "Program:exit"(node) {
        if (defaults.length === 0) {
          context.report({ node, messageId: "missing" });
          return;
        }
        for (const exported of defaults) {
          const declaration = unwrap(exported.declaration);
          const meta = declaration?.type === "Identifier" ? bindings.get(declaration.name) : declaration;
          if (!hasExplorationTag(meta)) context.report({ node: exported, messageId: "missing" });
        }
      },
    };
  },
};
