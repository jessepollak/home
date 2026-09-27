function unwrap(node) {
  while (node && ["TSSatisfiesExpression", "TSAsExpression"].includes(node.type)) node = node.expression;
  return node;
}

function hasExplorationTag(node) {
  const meta = unwrap(node);
  if (meta?.type !== "ObjectExpression") return false;
  if (meta.properties.some((property) => property.type !== "Property" || property.computed)) return false;
  const tags = meta.properties.filter((property) => (property.key.name ?? property.key.value) === "tags");
  if (tags.length !== 1 || tags[0].value?.type !== "ArrayExpression") return false;
  const elements = tags[0].value.elements;
  return elements.every((element) => element?.type === "Literal")
    && elements.some((element) => element.value === "exploration");
}

export const explorationStoryTag = {
  meta: {
    type: "problem",
    schema: [],
    messages: { missing: "Use inline exploration meta: export default { tags: [\"exploration\"] } or const meta = { tags: [\"exploration\"] }; export default meta." },
  },
  create(context) {
    return {
      "Program:exit"(node) {
        const bindings = new Map();
        const defaults = [];
        for (const statement of node.body) {
          const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
          if (declaration?.type === "VariableDeclaration" && declaration.kind === "const") {
            for (const variable of declaration.declarations) {
              if (variable.id.type === "Identifier") bindings.set(variable.id.name, variable.init);
            }
          }
          if (statement.type === "ExportDefaultDeclaration") defaults.push(statement);
        }
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
