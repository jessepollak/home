const wrappers = new Set([
  "ChainExpression", "ParenthesizedExpression", "TSAsExpression", "TSNonNullExpression",
  "TSSatisfiesExpression", "TSTypeAssertion",
]);
const writes = new Set(["writeText", "write"]);

function unwrap(node) {
  let current = node;
  while (current && wrappers.has(current.type)) current = current.expression;
  return current;
}

function propertyName(node, computed) {
  if (!computed && node.type === "Identifier") return node.name;
  if (node.type === "Literal" || node.type === "StringLiteral") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0]?.value.cooked;
  return undefined;
}

function variableFor(sourceCode, identifier) {
  let scope = sourceCode.getScope(identifier);
  while (scope) {
    const variable = scope.set.get(identifier.name);
    if (variable) return variable;
    scope = scope.upper;
  }
  return null;
}

function memberKinds(kinds, name) {
  if (kinds.has("window") && name === "navigator") return new Set(["navigator"]);
  if (kinds.has("navigator") && name === "clipboard") return new Set(["clipboard"]);
  return new Set();
}

export const noRawClipboardWrite = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      rejected: "Use CopyableValue / AddressText instead of raw clipboard writes in product code.",
    },
  },
  create(context) {
    const bindings = new Map();
    const assignments = [];
    const members = [];
    const rejected = new Set();

    function valueKinds(value) {
      const node = unwrap(value);
      if (node?.type === "Identifier") {
        const variable = variableFor(context.sourceCode, node);
        if ((!variable || variable.defs.length === 0) && ["window", "globalThis", "navigator"].includes(node.name)) {
          return new Set([node.name === "globalThis" ? "window" : node.name]);
        }
        return bindings.get(variable) ?? new Set();
      }
      if (node?.type === "MemberExpression") {
        return memberKinds(valueKinds(node.object), propertyName(node.property, node.computed));
      }
      return new Set();
    }

    function bindPattern(pattern, kinds) {
      const node = unwrap(pattern);
      if (!node || kinds.size === 0) return false;
      if (node.type === "AssignmentPattern") return bindPattern(node.left, kinds);
      if (node.type === "Identifier") {
        const variable = variableFor(context.sourceCode, node);
        if (!variable) return false;
        const bound = bindings.get(variable) ?? new Set();
        const before = bound.size;
        for (const kind of kinds) bound.add(kind);
        bindings.set(variable, bound);
        return bound.size !== before;
      }
      if (node.type !== "ObjectPattern") return false;
      let changed = false;
      for (const property of node.properties) {
        if (property.type !== "Property") continue;
        const name = propertyName(property.key, property.computed);
        if (kinds.has("clipboard") && writes.has(name)) rejected.add(property);
        if (bindPattern(property.value, memberKinds(kinds, name))) changed = true;
      }
      return changed;
    }

    return {
      VariableDeclarator(node) {
        if (node.init) assignments.push({ pattern: node.id, value: node.init });
      },
      AssignmentExpression(node) {
        if (node.operator === "=") assignments.push({ pattern: node.left, value: node.right });
      },
      MemberExpression(node) { members.push(node); },
      "Program:exit"() {
        let changed;
        do {
          changed = false;
          for (const { pattern, value } of assignments) {
            if (bindPattern(pattern, valueKinds(value))) changed = true;
          }
        } while (changed);
        for (const node of members) {
          if (writes.has(propertyName(node.property, node.computed)) && valueKinds(node.object).has("clipboard")) {
            rejected.add(node);
          }
        }
        for (const node of rejected) context.report({ node, messageId: "rejected" });
      },
    };
  },
};
