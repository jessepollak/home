import path from "node:path";

const layoutPrefixes = [
  "aspect-", "container", "columns-", "break-", "box-", "block", "inline", "hidden", "table", "flow-root",
  "float-", "clear-", "isolate", "isolation-", "object-", "overflow-", "overscroll-",
  "static", "fixed", "absolute", "relative", "sticky", "inset-", "inset-x-", "inset-y-", "start-", "end-",
  "top-", "right-", "bottom-", "left-", "visible", "invisible", "collapse", "z-",
  "basis-", "flex", "flex-", "grow", "grow-", "shrink", "shrink-", "order-",
  "grid", "grid-", "col-", "row-", "auto-cols-", "auto-rows-", "gap-", "gap-x-", "gap-y-",
  "justify-", "items-", "content-", "self-", "place-",
  "p-", "px-", "py-", "pt-", "pr-", "pb-", "pl-", "ps-", "pe-",
  "m-", "mx-", "my-", "mt-", "mr-", "mb-", "ml-", "ms-", "me-", "space-x-", "space-y-",
  "w-", "min-w-", "max-w-", "h-", "min-h-", "max-h-", "size-",
  "text-left", "text-right", "text-center", "text-start", "text-end", "text-justify",
  "cursor-", "sr-only", "not-sr-only", "whitespace-", "translate-", "translate-x-", "translate-y-", "select-",
];

function utilityBase(token) {
  const parts = token.split(":");
  return parts.at(-1)?.replace(/^!/, "").replace(/^-/, "") ?? "";
}

function isLayoutUtility(token) {
  const base = utilityBase(token);
  return layoutPrefixes.some((prefix) => base === prefix || base.startsWith(prefix));
}

function stringParts(node, found = []) {
  if (!node) return found;
  if ((node.type === "Literal" || node.type === "StringLiteral") && typeof node.value === "string") found.push(node.value);
  else if (node.type === "TemplateLiteral") {
    for (const quasi of node.quasis) found.push(quasi.value.raw);
    for (const expression of node.expressions) stringParts(expression, found);
  } else if (node.type === "CallExpression") {
    for (const argument of node.arguments) stringParts(argument, found);
  } else if (node.type === "ConditionalExpression") {
    stringParts(node.consequent, found);
    stringParts(node.alternate, found);
  } else if (node.type === "LogicalExpression") {
    if (node.operator !== "&&") stringParts(node.left, found);
    stringParts(node.right, found);
  } else if (node.type === "BinaryExpression" && node.operator === "+") {
    stringParts(node.left, found);
    stringParts(node.right, found);
  } else if (node.type === "ArrayExpression") {
    for (const element of node.elements) stringParts(element, found);
  } else if (node.type === "ObjectExpression") {
    for (const property of node.properties) {
      if (property.type === "Property") {
        if (!property.computed && (property.key.type === "Literal" || property.key.type === "StringLiteral")) stringParts(property.key, found);
      }
    }
  }
  return found;
}

function importedName(specifier) {
  if (specifier.type === "ImportSpecifier" || specifier.type === "ImportDefaultSpecifier") return specifier.local.name;
  return null;
}

function isOwnedUiImport(source, filename) {
  if (source.startsWith("@/components/ui/")) return true;
  if (!source.startsWith(".")) return false;
  const importer = String(filename ?? "").replaceAll("\\", "/");
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(importer), source));
  return resolved.split("/").some((segment, index, segments) =>
    segment === "components" && segments[index + 1] === "ui");
}

export const noRestyle = {
  meta: {
    type: "problem",
    schema: [{ type: "object", additionalProperties: true }],
    messages: { rejected: "Owned UI components may only receive layout utilities; '{{className}}' changes their appearance." },
  },
  create(context) {
    const ownedComponents = new Set();
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (typeof source !== "string" || !isOwnedUiImport(source, context.filename)) return;
        for (const specifier of node.specifiers) {
          const name = importedName(specifier);
          if (name) ownedComponents.add(name);
        }
      },
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier" || !ownedComponents.has(node.name.name)) return;
        const className = node.attributes.find((attribute) =>
          attribute.type === "JSXAttribute" && attribute.name.type === "JSXIdentifier" && attribute.name.name === "className");
        if (!className?.value) return;
        const value = className.value.type === "JSXExpressionContainer" ? className.value.expression : className.value;
        const rejected = stringParts(value)
          .flatMap((part) => part.trim().split(/\s+/))
          .find((token) => token && !isLayoutUtility(token));
        if (rejected) context.report({ node: className, messageId: "rejected", data: { className: rejected } });
      },
    };
  },
};
