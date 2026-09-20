function rawElementRule(names, message) {
  return {
    meta: { type: "problem", schema: [], messages: { rejected: message } },
    create(context) {
      return {
        JSXOpeningElement(node) {
          if (node.name.type === "JSXIdentifier" && names.has(node.name.name)) {
            context.report({ node, messageId: "rejected" });
          }
        },
      };
    },
  };
}

export const noRawButtons = rawElementRule(
  new Set(["button"]),
  "Use Button from @/components/ui/button. The raw-button allowlist only shrinks.",
);

export const noRawFields = rawElementRule(
  new Set(["input", "select"]),
  "Use Input or Select from @/components/ui. The raw-field allowlist only shrinks.",
);
