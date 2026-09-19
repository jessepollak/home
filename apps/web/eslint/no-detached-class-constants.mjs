// Product JSX must keep Tailwind utilities inline at the use site; reusable
// presentation belongs in owned `components/ui` variants. This rule follows
// identifiers referenced by `className` attributes and `cn()` arguments back to
// their local definitions and rejects the ones that resolve to static class
// strings (literals, expression-free templates, and fully static
// concatenations, including through local aliases). Traversal is
// expression-role-aware: only positions whose value can become part of the
// class output (results, branch bodies, template interpolations, and
// concatenations) are analyzed, so condition tests, comparison operands, and
// cn() object condition values are never treated as classes. The className and
// standalone-cn() visitors coordinate: a nested cn() defers to its enclosing
// relevant root (the className value or outer cn() argument) instead of
// re-analyzing its own arguments, so a cn() in a predicate or condition
// position is never treated as a class source while class-producing nested
// calls stay flagged. Resolution is by scope binding, never by identifier
// naming, so shadowed props, parameters, imports, and dynamic initializers all
// pass.
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

// Collect reference identifiers inside a className/cn() value, following only
// expression roles whose value can actually become part of the class output:
// results, branch bodies, template interpolations, and concatenations. A
// detached constant in a predicate or data position (logical/conditional
// tests, comparison operands, cn() object condition values, member/index
// access) never reaches the class string, so those roles are not analyzed.
// Nested JSX and function bodies remain boundaries so unrelated identifiers
// are never visited. Aggregate object/array class sources are deliberately
// not resolved.
function collectReferenceIdentifiers(node, found) {
  if (!node || typeof node.type !== "string") return;
  switch (node.type) {
    // Boundaries: nested JSX and function bodies never name className values.
    case "JSXElement":
    case "JSXFragment":
    case "ArrowFunctionExpression":
    case "FunctionExpression":
    case "FunctionDeclaration":
    case "ClassExpression":
    case "ClassDeclaration":
      return;
    case "Identifier":
      if (isReferenceIdentifier(node)) found.add(node);
      return;
    case "CallExpression": {
      collectReferenceIdentifiers(node.callee, found);
      if (node.callee.type === "Identifier" && node.callee.name === "cn") {
        for (const argument of node.arguments) collectReferenceIdentifiers(argument, found);
      }
      return;
    }
    case "LogicalExpression":
      // `a && b`: `a` is only a truthiness test — falsy results are skipped by
      // class composition, so its value can never land in the class output.
      // `a || b` / `a ?? b`: a truthy `a` is the result, so it is class data.
      if (node.operator === "&&") {
        collectReferenceIdentifiers(node.right, found);
      } else {
        collectReferenceIdentifiers(node.left, found);
        collectReferenceIdentifiers(node.right, found);
      }
      return;
    case "ConditionalExpression":
      // The test is condition data; the branches supply the class.
      collectReferenceIdentifiers(node.consequent, found);
      collectReferenceIdentifiers(node.alternate, found);
      return;
    case "BinaryExpression":
      // Only `+` can build the class string; comparison and arithmetic
      // operands are data.
      if (node.operator === "+") {
        collectReferenceIdentifiers(node.left, found);
        collectReferenceIdentifiers(node.right, found);
      }
      return;
    case "TemplateLiteral":
      // Interpolations become part of the class string; quasis are literals.
      for (const expression of node.expressions) collectReferenceIdentifiers(expression, found);
      return;
    case "ObjectExpression":
      // `cn({ "bg-primary": cond })`: values are conditions, not classes.
      return;
    case "MemberExpression":
      // `map[status]`: object and index are data, not class sources.
      return;
    case "UnaryExpression":
    case "UpdateExpression":
      // The operand is coerced to a boolean/number and never reaches output.
      return;
    default:
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
}

// Decide whether a cn() call sits in a region whose role classification the
// enclosing relevant root — the className attribute value or an outer cn()
// argument — already owns. The standalone CallExpression visitor defers in
// that case: the root's role-aware traversal either analyzes the region as
// class-producing or deliberately ignores it as predicate/data, and
// re-analyzing from the nested call would flag condition data (a ternary
// test, an object condition value, a negation operand) as classes. The walk
// stops — returning false so the standalone visitor stays the safety net — at
// the same regions the traversal never classifies: nested function and class
// bodies, nested JSX, arguments of non-cn calls, and member-access
// subexpressions (where a nested cn() result can still be class-producing,
// e.g. `cn(pad).trim()`).
function isOwnedByEnclosingRoot(node) {
  let child = node;
  for (let parent = child.parent; parent; child = parent, parent = parent.parent) {
    switch (parent.type) {
      case "ArrowFunctionExpression":
      case "FunctionExpression":
      case "FunctionDeclaration":
      case "ClassExpression":
      case "ClassDeclaration":
      case "JSXElement":
      case "JSXFragment":
        return false;
      case "CallExpression":
        // A callee keeps the walk going: the root classifies callee
        // expressions transitively. An argument of an enclosing cn() call is
        // inside that root's role-aware traversal; an argument of any other
        // call is outside the traversal's ownership.
        if (parent.callee === child) break;
        return parent.callee.type === "Identifier" && parent.callee.name === "cn";
      case "JSXAttribute":
        return parent.name.type === "JSXIdentifier" && parent.name.name === "className";
      case "MemberExpression":
        return false;
      default:
        // Every other position between the nested call and the root is one
        // the role-aware traversal either analyzes or deliberately ignores.
        break;
    }
  }
  return false;
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
        // The enclosing relevant root owns role classification for this
        // region; only standalone cn() calls re-analyze their arguments.
        if (isOwnedByEnclosingRoot(node)) return;
        for (const argument of node.arguments) checkValue(argument);
      },
    };
  },
};
