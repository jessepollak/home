// Product JSX must keep Tailwind utilities inline at the use site; reusable
// presentation belongs in owned `components/ui` variants. This rule follows
// identifiers referenced by `className` attributes and `cn()` arguments back to
// local static class strings. It also follows reached object/array lookups back
// through immutable local aliases to fully static class maps. Resolution uses
// Oxlint's scope bindings, so declaration order, shadowing, and writes anywhere
// in the binding's lifetime are handled consistently.
const MAX_RESOLVE_DEPTH = 10;

function unwrapTsExpression(node) {
  let current = node;
  while (current && [
    "ParenthesizedExpression",
    "ChainExpression",
    "TSAsExpression",
    "TSSatisfiesExpression",
    "TSNonNullExpression",
    "TSTypeAssertion",
  ].includes(current.type)) current = current.expression;
  return current;
}

function resolveBinding(sourceCode, node) {
  const identifier = unwrapTsExpression(node);
  if (identifier?.type !== "Identifier") return null;
  let scope = sourceCode.getScope(identifier);
  while (scope) {
    const variable = scope.set.get(identifier.name);
    if (variable) return variable;
    scope = scope.upper;
  }
  return null;
}

function immutableVariableDeclarator(sourceCode, identifier, { requireConst = false } = {}) {
  const variable = resolveBinding(sourceCode, identifier);
  if (!variable || variable.defs.length !== 1
    || variable.references.some((reference) => reference.isWrite() && !reference.init)) return null;
  const definition = variable.defs[0];
  if (definition.type !== "Variable" || definition.node?.type !== "VariableDeclarator"
    || definition.node.id.type !== "Identifier" || !definition.node.init) return null;
  if (requireConst && definition.node.parent?.kind !== "const") return null;
  return { declarator: definition.node, variable };
}

function isStaticString(node, resolveIdentifier, depth = 0) {
  if (!node || depth > MAX_RESOLVE_DEPTH) return null;
  const expression = unwrapTsExpression(node);
  if (!expression) return null;
  if (expression.type === "Identifier") return resolveIdentifier(expression, depth + 1);
  if (expression.type === "Literal" && typeof expression.value === "string") return expression.value;
  if (expression.type === "TemplateLiteral" && expression.expressions.length === 0) {
    return expression.quasis[0]?.value.cooked ?? null;
  }
  if (expression.type === "BinaryExpression" && expression.operator === "+") {
    const left = isStaticString(expression.left, resolveIdentifier, depth + 1);
    if (left === null) return null;
    const right = isStaticString(expression.right, resolveIdentifier, depth + 1);
    return right === null ? null : left + right;
  }
  return null;
}

function staticPropertyKey(property, resolveIdentifier) {
  if (property.computed) return staticLookupKey(property.key, resolveIdentifier);
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "Literal"
    && (typeof property.key.value === "string" || typeof property.key.value === "number")) {
    return String(property.key.value);
  }
  return null;
}

function staticAggregateEntries(aggregate, resolveIdentifier) {
  if (aggregate.type === "ObjectExpression") {
    const entries = new Map();
    for (const property of aggregate.properties) {
      if (property.type !== "Property") return null;
      const key = staticPropertyKey(property, resolveIdentifier);
      if (key === null) return null;
      // Object literals use last-write-wins semantics for duplicate keys. Only
      // the final value is reachable through a lookup, including unknown keys.
      entries.set(key, { key, value: property.value });
    }
    return [...entries.values()];
  }
  if (aggregate.type === "ArrayExpression") {
    const entries = [];
    for (let index = 0; index < aggregate.elements.length; index += 1) {
      const element = aggregate.elements[index];
      if (!element || element.type === "SpreadElement") return null;
      entries.push({ key: String(index), value: element });
    }
    return entries;
  }
  return null;
}

function staticLookupKey(node, resolveIdentifier) {
  const key = unwrapTsExpression(node);
  if (!key) return null;
  if (key.type === "Literal" && typeof key.value === "number") return String(key.value);
  if (key.type === "UnaryExpression" && key.operator === "-"
    && key.argument?.type === "Literal" && typeof key.argument.value === "number") {
    return String(-key.argument.value);
  }
  return isStaticString(key, resolveIdentifier);
}

function lastMatchingEntry(entries, key) {
  let value = null;
  for (const entry of entries) if (entry.key === key) value = entry.value;
  return value;
}

function collectClassSources(node, found) {
  if (!node || typeof node.type !== "string") return;
  switch (node.type) {
    case "JSXElement":
    case "JSXFragment":
    case "ArrowFunctionExpression":
    case "FunctionExpression":
    case "FunctionDeclaration":
    case "ClassExpression":
    case "ClassDeclaration":
      return;
    case "Identifier":
      found.add(node);
      return;
    case "CallExpression":
      collectClassSources(node.callee, found);
      if (node.callee.type === "Identifier" && node.callee.name === "cn") {
        for (const argument of node.arguments) collectClassSources(argument, found);
      }
      return;
    case "LogicalExpression":
      if (node.operator === "&&") collectClassSources(node.right, found);
      else {
        collectClassSources(node.left, found);
        collectClassSources(node.right, found);
      }
      return;
    case "ConditionalExpression":
      collectClassSources(node.consequent, found);
      collectClassSources(node.alternate, found);
      return;
    case "BinaryExpression":
      if (node.operator === "+") {
        collectClassSources(node.left, found);
        collectClassSources(node.right, found);
      }
      return;
    case "TemplateLiteral":
      for (const expression of node.expressions) collectClassSources(expression, found);
      return;
    case "SequenceExpression":
      // Only the final expression becomes the sequence result. Earlier
      // expressions execute for side effects but cannot supply class output.
      collectClassSources(node.expressions.at(-1), found);
      return;
    case "ObjectExpression":
      // Object values in cn({ className: condition }) are predicates.
      return;
    case "MemberExpression":
      // The lookup is a candidate, but its key is data. Nested member objects
      // are walked so map[key].trim() still reaches map[key].
      found.add(node);
      if (unwrapTsExpression(node.object)?.type !== "Identifier") collectClassSources(node.object, found);
      return;
    case "UnaryExpression":
    case "UpdateExpression":
      return;
    default:
      for (const key of Object.keys(node)) {
        if (["parent", "range", "loc"].includes(key)) continue;
        const child = node[key];
        if (Array.isArray(child)) {
          for (const item of child) collectClassSources(item, found);
        } else if (child && typeof child.type === "string") collectClassSources(child, found);
      }
  }
}

export const noDetachedClassConstantsRule = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      detached:
        "Keep Tailwind utilities inline in className/cn(): '{{name}}' resolves to a static class string. Inline the utilities at this use site, or move reusable presentation into an owned component variant.",
      detachedAggregate:
        "Keep Tailwind utilities inline in className/cn(): '{{name}}' is a local static class map whose lookup resolves to class strings. Inline the utilities at this use site, or move reusable presentation into an owned component variant.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const ownedCalls = new Set();

    function resolveBoundStaticString(identifier, depth, visited, requireConst) {
      if (depth > MAX_RESOLVE_DEPTH) return null;
      const binding = immutableVariableDeclarator(sourceCode, identifier, { requireConst });
      if (!binding || visited.has(binding.variable)) return null;
      const nextVisited = new Set(visited);
      nextVisited.add(binding.variable);
      return isStaticString(
        binding.declarator.init,
        (nextIdentifier, nextDepth) => resolveBoundStaticString(
          nextIdentifier,
          nextDepth,
          nextVisited,
          requireConst,
        ),
        depth + 1,
      );
    }

    function resolveStaticString(identifier, depth = 0) {
      return resolveBoundStaticString(identifier, depth, new Set(), false);
    }

    function resolveConstStaticString(identifier, depth = 0) {
      return resolveBoundStaticString(identifier, depth, new Set(), true);
    }

    function climbTransparentExpression(node) {
      let current = node;
      while (current.parent && [
        "ParenthesizedExpression",
        "ChainExpression",
        "TSAsExpression",
        "TSSatisfiesExpression",
        "TSNonNullExpression",
        "TSTypeAssertion",
      ].includes(current.parent.type) && current.parent.expression === current) current = current.parent;
      return current;
    }

    function climbAssignmentTarget(node) {
      let current = node;
      while (current.parent) {
        const parent = current.parent;
        if ((parent.type === "Property" && parent.value === current)
          || (parent.type === "RestElement" && parent.argument === current)
          || (parent.type === "AssignmentPattern" && parent.left === current)
          || (parent.type === "ObjectPattern" && parent.properties.includes(current))
          || (parent.type === "ArrayPattern" && parent.elements.includes(current))) {
          current = parent;
          continue;
        }
        break;
      }
      return current;
    }

    function memberMutationFromReference(identifier) {
      let current = climbTransparentExpression(identifier);
      if (current.parent?.type !== "MemberExpression" || current.parent.object !== current) return false;
      current = current.parent;
      while (true) {
        current = climbTransparentExpression(current);
        if (current.parent?.type !== "MemberExpression" || current.parent.object !== current) break;
        current = current.parent;
      }
      current = climbTransparentExpression(current);
      const directParent = current.parent;
      if ((directParent?.type === "UpdateExpression" && directParent.argument === current)
        || (directParent?.type === "UnaryExpression"
          && directParent.operator === "delete" && directParent.argument === current)) return true;

      const target = climbAssignmentTarget(current);
      const parent = target.parent;
      return Boolean(
        (parent?.type === "AssignmentExpression" && parent.left === target)
        || ((parent?.type === "ForInStatement" || parent?.type === "ForOfStatement")
          && parent.left === target)
      );
    }

    function constAliasFromReference(identifier) {
      const expression = climbTransparentExpression(identifier);
      const declarator = expression.parent;
      if (declarator?.type !== "VariableDeclarator" || declarator.init !== expression
        || declarator.id.type !== "Identifier" || declarator.parent?.kind !== "const") return null;
      return resolveBinding(sourceCode, declarator.id);
    }

    // A const binding does not make the object it holds immutable. Inspect all
    // references, plus bounded const aliases of the same object, so member
    // writes before or after a class lookup invalidate aggregate resolution.
    function hasAggregateMemberMutation(variable, depth = 0, visited = new Set()) {
      if (depth > MAX_RESOLVE_DEPTH || visited.has(variable)) return false;
      const nextVisited = new Set(visited);
      nextVisited.add(variable);
      for (const reference of variable.references) {
        const identifier = reference.identifier;
        if (!identifier) continue;
        if (memberMutationFromReference(identifier)) return true;
        const alias = constAliasFromReference(identifier);
        if (alias && hasAggregateMemberMutation(alias, depth + 1, nextVisited)) return true;
      }
      return false;
    }

    function resolveStaticAggregate(identifier, depth = 0, visited = new Set()) {
      if (depth > MAX_RESOLVE_DEPTH) return null;
      const binding = immutableVariableDeclarator(sourceCode, identifier, { requireConst: true });
      if (!binding || visited.has(binding.variable)
        || hasAggregateMemberMutation(binding.variable)) return null;
      const nextVisited = new Set(visited);
      nextVisited.add(binding.variable);
      const init = unwrapTsExpression(binding.declarator.init);
      if (init?.type === "Identifier") return resolveStaticAggregate(init, depth + 1, nextVisited);
      return init?.type === "ObjectExpression" || init?.type === "ArrayExpression" ? init : null;
    }

    function resolveAggregateLookup(member) {
      const object = unwrapTsExpression(member.object);
      if (object?.type !== "Identifier") return null;
      const aggregate = resolveStaticAggregate(object);
      if (!aggregate) return null;
      const entries = staticAggregateEntries(aggregate, resolveConstStaticString);
      if (!entries?.length) return null;

      let candidates;
      if (!member.computed) {
        if (member.property.type !== "Identifier") return null;
        const selected = lastMatchingEntry(entries, member.property.name);
        if (selected === null) return null;
        candidates = [selected];
      } else {
        const key = staticLookupKey(member.property, resolveConstStaticString);
        if (key === null) candidates = entries.map((entry) => entry.value);
        else {
          const selected = lastMatchingEntry(entries, key);
          if (selected === null) return null;
          candidates = [selected];
        }
      }

      for (const candidate of candidates) {
        const value = isStaticString(candidate, resolveConstStaticString);
        if (value === null || value.trim() === "") return null;
      }
      return object.name;
    }

    function callKey(node) {
      return node.range?.join(":") ?? `${node.start ?? ""}:${node.end ?? ""}`;
    }
    function markNestedCnCalls(node) {
      if (!node || typeof node.type !== "string") return;
      if (node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "cn") {
        ownedCalls.add(callKey(node));
      }
      for (const key of Object.keys(node)) {
        if (["parent", "range", "loc"].includes(key)) continue;
        const child = node[key];
        if (Array.isArray(child)) for (const item of child) markNestedCnCalls(item);
        else if (child && typeof child.type === "string") markNestedCnCalls(child);
      }
    }
    function checkValue(value) {
      const sources = new Set();
      collectClassSources(value, sources);
      for (const source of sources) {
        if (source.type === "MemberExpression") {
          const name = resolveAggregateLookup(source);
          if (name !== null) context.report({ node: source, messageId: "detachedAggregate", data: { name } });
          continue;
        }
        const staticString = resolveStaticString(source);
        if (staticString === null || staticString.trim() === "") continue;
        context.report({ node: source, messageId: "detached", data: { name: source.name } });
      }
    }

    return {
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier" || node.name.name !== "className" || !node.value) return;
        const value = node.value.type === "JSXExpressionContainer" ? node.value.expression : node.value;
        markNestedCnCalls(value);
        checkValue(value);
      },
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "cn" || ownedCalls.has(callKey(node))) return;
        for (const argument of node.arguments) markNestedCnCalls(argument);
        for (const argument of node.arguments) checkValue(argument);
      },
    };
  },
};
