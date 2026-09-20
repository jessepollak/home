export const requireServerOnly = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      missing: 'Server modules must start with `import "server-only";` to prevent accidental client imports.',
    },
  },
  create(context) {
    return {
      Program(node) {
        const firstImport = node.body.find((statement) => statement.type === "ImportDeclaration");
        if (firstImport?.source.value === "server-only" && firstImport.specifiers.length === 0) return;
        context.report({ node: firstImport ?? node, messageId: "missing" });
      },
    };
  },
};
