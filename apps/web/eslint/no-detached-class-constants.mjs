// Product JSX must keep Tailwind utilities inline at the use site; reusable
// presentation belongs in owned `components/ui` variants. This rule follows
// identifiers referenced by `className` attributes and `cn()` arguments back to
// their local definitions and rejects the ones that resolve to static class
// strings (literals, expression-free templates, and fully static
// concatenations, including through local aliases). Resolution is by scope
// binding, never by identifier naming, so shadowed props, parameters, imports,
// and dynamic initializers all pass.
const MAX_RESOLVE_DEPTH = 10;

// `resolveIdentifier` routes identifier operands (aliases) back through the
// caller's binding resolution so concatenations like `pad + "py-2"` stay
// statically known when `pad` is a local constant.
function isStaticString(node, resolveIdentifier, depth = 0) {
  if (!node || depth > MAX_RESOLVE_DEPTH) return null;
  if (node.type === "Identifier") return resolveIdentifier(node, depth + 1);
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? null;
  }
  if (node.type === "BinaryExpression" && node.operator === "+") {
    const left = isStaticString(node.left, resolveIdentifier, depth + 1);
    if (left === null) return null;
    const right = isStaticString(node.right, resolveIdentifier, depth + 1);
    return right === null ? null : left + right;
  }
  return null;
}

function isReferenceIdentifier(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (parent.type === "MemberExpression" && parent.property === node && !parent.computed) return false;
  if (parent.type === "Property" && parent.key === node && !parent.computed) return false;
  if (parent.type === "PropertyDefinition" && parent.key === node && !parent.computed) return false;
  if (parent.type === "VariableDeclarator" && parent.id === node) return false;
  if (parent.type === "FunctionDeclaration" && parent.id === node) return false;
  if ((parent.type === "FunctionExpression" || parent.type === "ArrowFunctionExpression") && parent.params.includes(node)) return false;
  return true;
}

// Collect reference identifiers inside a className/cn() value. Composition
// (ternaries, logical expressions, templates, nested `cn()` calls) stays
// reachable so detached constants cannot hide inside it; nested JSX and
// function bodies are boundaries so unrelated identifiers are never visited.
function collectReferenceIdentifiers(node, found) {
  if (!node || typeof node.type !== "string") return;
  if (node.type === "JSXElement" || node.type === "JSXFragment") return;
  if (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression" || node.type === "FunctionDeclaration" || node.type === "ClassExpression" || node.type === "ClassDeclaration") return;
  if (node.type === "Identifier") {
    if (isReferenceIdentifier(node)) found.add(node);
    return;
  }
  if (node.type === "CallExpression") {
    collectReferenceIdentifiers(node.callee, found);
    if (node.callee.type === "Identifier" && node.callee.name === "cn") {
      for (const argument of node.arguments) collectReferenceIdentifiers(argument, found);
    }
    return;
  }
  for (const key of Object.keys(node)) {
    if (key === "parent" || key === "range" || key === "loc") continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) collectReferenceIdentifiers(item, found);
    } else if (child && typeof child.type === "string") {
      collectReferenceIdentifiers(child, found);
    }
  }
}

function findBinding(sourceCode, identifier) {
  let scope = sourceCode.getScope(identifier);
  while (scope) {
    if (scope.set.has(identifier.name)) return scope.set.get(identifier.name);
    scope = scope.upper;
  }
  return null;
}

export const noDetachedClassConstantsRule = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      detached:
        "Keep Tailwind utilities inline in className/cn(): '{{name}}' resolves to a static class string. Inline the utilities at this use site, or move reusable presentation into an owned component variant.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const reported = new Set();

    // Resolve a reference identifier to the static class string it holds, or
    // null when the value is not local or not statically known. Parameters,
    // imports, calls, conditionals, and interpolated templates all resolve to
    // null: those are the allowed dynamic or owned-component patterns.
    function resolveStaticString(identifier, depth = 0) {
      if (depth > MAX_RESOLVE_DEPTH) return null;
      const binding = findBinding(sourceCode, identifier);
      if (!binding || !binding.defs || binding.defs.length === 0) return null;
      const def = binding.defs[0];
      if (def.type !== "Variable" || !def.node || def.node.type !== "VariableDeclarator") return null;
      if (def.node.id === identifier) return null;
      // A variable reassigned after initialization may hold different class
      // strings at runtime; treat it as dynamic rather than guess.
      if (binding.references.some((reference) => reference.isWrite() && !reference.init)) return null;
      const init = def.node.init;
      if (!init) return null;
      if (init.type === "Identifier") return resolveStaticString(init, depth + 1);
      return isStaticString(init, resolveStaticString, depth + 1);
    }

    function checkValue(value) {
      const identifiers = new Set();
      collectReferenceIdentifiers(value, identifiers);
      for (const identifier of identifiers) {
        if (reported.has(identifier)) continue;
        const staticString = resolveStaticString(identifier);
        if (staticString === null || staticString.trim() === "") continue;
        reported.add(identifier);
        context.report({
          node: identifier,
          messageId: "detached",
          data: { name: identifier.name },
        });
      }
    }

    return {
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier" || node.name.name !== "className") return;
        if (!node.value) return;
        checkValue(node.value.type === "JSXExpressionContainer" ? node.value.expression : node.value);
      },
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "cn") return;
        for (const argument of node.arguments) checkValue(argument);
      },
    };
  },
};
