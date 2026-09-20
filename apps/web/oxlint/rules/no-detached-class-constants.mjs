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
      found.add(node);
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

function bindingNames(pattern, names = []) {
  if (!pattern) return names;
  if (pattern.type === "Identifier") names.push(pattern);
  else if (pattern.type === "RestElement") bindingNames(pattern.argument, names);
  else if (pattern.type === "AssignmentPattern") bindingNames(pattern.left, names);
  else if (pattern.type === "ObjectPattern") {
    for (const property of pattern.properties) {
      if (property.type === "Property") bindingNames(property.value, names);
      else bindingNames(property.argument, names);
    }
  } else if (pattern.type === "ArrayPattern") {
    for (const element of pattern.elements) bindingNames(element, names);
  }
  return names;
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
    const scopes = [];
    const ownedCalls = new Set();

    function pushScope() { scopes.push(new Map()); }
    function popScope() { scopes.pop(); }
    function define(name, value = null) {
      scopes.at(-1)?.set(name, { value, reassigned: false });
    }
    function resolve(name) {
      for (let index = scopes.length - 1; index >= 0; index -= 1) {
        const binding = scopes[index].get(name);
        if (binding) return binding;
      }
      return null;
    }
    function staticValue(node, depth = 0) {
      if (!node || depth > MAX_RESOLVE_DEPTH) return null;
      if (node.type === "Identifier") {
        const binding = resolve(node.name);
        return binding && !binding.reassigned ? binding.value : null;
      }
      return isStaticString(node, (identifier, nextDepth) => staticValue(identifier, nextDepth), depth);
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
      const identifiers = new Set();
      collectReferenceIdentifiers(value, identifiers);
      for (const identifier of identifiers) {
        const value = staticValue(identifier);
        if (value === null || value.trim() === "") continue;
        context.report({ node: identifier, messageId: "detached", data: { name: identifier.name } });
      }
    }
    function enterFunction(node) {
      pushScope();
      for (const parameter of node.params) {
        for (const name of bindingNames(parameter)) define(name.name);
      }
    }
    function exitFunction() { popScope(); }

    return {
      Program: pushScope,
      "Program:exit": popScope,
      BlockStatement: pushScope,
      "BlockStatement:exit": popScope,
      FunctionDeclaration: enterFunction,
      "FunctionDeclaration:exit": exitFunction,
      FunctionExpression: enterFunction,
      "FunctionExpression:exit": exitFunction,
      ArrowFunctionExpression: enterFunction,
      "ArrowFunctionExpression:exit": exitFunction,
      ImportSpecifier(node) { define(node.local.name); },
      ImportDefaultSpecifier(node) { define(node.local.name); },
      ImportNamespaceSpecifier(node) { define(node.local.name); },
      VariableDeclarator(node) {
        const value = node.id.type === "Identifier" ? staticValue(node.init) : null;
        for (const name of bindingNames(node.id)) define(name.name, value);
      },
      AssignmentExpression(node) {
        if (node.left.type === "Identifier") {
          const binding = resolve(node.left.name);
          if (binding) binding.reassigned = true;
        }
      },
      UpdateExpression(node) {
        if (node.argument.type === "Identifier") {
          const binding = resolve(node.argument.name);
          if (binding) binding.reassigned = true;
        }
      },
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
