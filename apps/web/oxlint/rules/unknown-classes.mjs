import { allowedCustomClasses } from "../policy/custom-classes.mjs";
import { isKnownClass } from "../policy/design-system.mjs";

const message =
  "Unknown Tailwind class '{{className}}'; use a theme-backed utility or register the custom class in oxlint/policy/custom-classes.mjs.";

// Variant/marker tokens that Tailwind emits as plain hooks rather than utilities.
const markerPattern = /^(?:group|peer|dark)$|^(?:group|peer)\/[^\s:]+$/;

function propertyName(property) {
  if (property.computed) return null;
  if (property.key.type === "Identifier") return property.key.name;
  if ((property.key.type === "Literal" || property.key.type === "StringLiteral") && typeof property.key.value === "string") return property.key.value;
  return null;
}

// Literal/template class strings, including conditionals, logicals, and arrays.
function literalClasses(node, found = []) {
  if (!node) return found;
  if ((node.type === "Literal" || node.type === "StringLiteral") && typeof node.value === "string") found.push(node.value);
  else if (node.type === "TemplateLiteral") {
    for (const quasi of node.quasis) found.push(quasi.value.raw);
    for (const expression of node.expressions) literalClasses(expression, found);
  } else if (node.type === "ConditionalExpression") {
    literalClasses(node.consequent, found);
    literalClasses(node.alternate, found);
  } else if (node.type === "LogicalExpression") {
    if (node.operator !== "&&") literalClasses(node.left, found);
    literalClasses(node.right, found);
  } else if (node.type === "BinaryExpression" && node.operator === "+") {
    literalClasses(node.left, found);
    literalClasses(node.right, found);
  } else if (node.type === "ArrayExpression") {
    for (const element of node.elements) literalClasses(element, found);
  }
  return found;
}

// clsx-style object arguments: reviewed string keys are the classes.
function objectKeyClasses(node, found = []) {
  if (node.type !== "ObjectExpression") return found;
  for (const property of node.properties) {
    if (property.type !== "Property") continue;
    const key = propertyName(property);
    if (typeof key === "string") found.push(key);
  }
  return found;
}

// Class values reached through cva variant/option objects and arrays; keys are names, not classes.
function valueClasses(node, found = []) {
  if (!node) return found;
  if (node.type === "ObjectExpression") {
    for (const property of node.properties) {
      if (property.type === "Property" && !property.computed) valueClasses(property.value, found);
    }
  } else if (node.type === "ArrayExpression") {
    for (const element of node.elements) valueClasses(element, found);
  } else {
    literalClasses(node, found);
  }
  return found;
}

// compoundVariants entries carry selector keys plus an explicit class/className value.
function compoundClasses(node, found = []) {
  const entries = node?.type === "ArrayExpression" ? node.elements : [node];
  for (const entry of entries) {
    if (entry?.type !== "ObjectExpression") continue;
    for (const property of entry.properties) {
      if (property.type !== "Property" || property.computed) continue;
      const key = propertyName(property);
      if (key === "class" || key === "className") literalClasses(property.value, found);
    }
  }
  return found;
}

function unknownToken(value) {
  for (const token of value.trim().split(/\s+/)) {
    if (!token || token.includes("${")) continue;
    if (markerPattern.test(token)) continue;
    if (allowedCustomClasses.has(token)) continue;
    if (!isKnownClass(token)) return token;
  }
  return null;
}

export const noUnknownTailwindClasses = {
  meta: { type: "problem", schema: [], messages: { unknown: message } },
  create(context) {
    function report(node, values) {
      const token = values.map(unknownToken).find((candidate) => candidate !== null);
      if (token) context.report({ node, messageId: "unknown", data: { className: token } });
    }
    return {
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier" || node.name.name !== "className" || !node.value) return;
        const expression = node.value.type === "JSXExpressionContainer" ? node.value.expression : node.value;
        report(node, literalClasses(expression));
      },
      CallExpression(node) {
        if (node.callee.type !== "Identifier") return;
        if (node.callee.name === "cn") {
          const values = [];
          for (const argument of node.arguments) {
            if (argument.type === "ObjectExpression") objectKeyClasses(argument, values);
            else literalClasses(argument, values);
          }
          report(node, values);
        } else if (node.callee.name === "cva") {
          const values = [];
          const [base, config] = node.arguments;
          literalClasses(base, values);
          if (config?.type === "ObjectExpression") {
            for (const property of config.properties) {
              if (property.type !== "Property" || property.computed) continue;
              const key = propertyName(property);
              if (key === "variants") valueClasses(property.value, values);
              else if (key === "compoundVariants") compoundClasses(property.value, values);
            }
          }
          report(node, values);
        }
      },
    };
  },
};
