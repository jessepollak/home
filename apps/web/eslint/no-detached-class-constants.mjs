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
//
// Local aggregate class maps are covered too. A lookup (`MAP[key]`,
// `MAP.active`, `MAP[0]`) reached in a class-producing role is rejected when
// its object resolves by local scope binding — through bounded aliases and
// TS-only wrappers such as `as const` — to a fully static ObjectExpression or
// ArrayExpression whose reachable lookup values are all non-empty static class
// strings. TS-only wrappers (`as const`, `satisfies`, non-null assertions,
// type assertions) are transparent throughout static resolution: they are
// unwrapped on objects, aliases, values, concatenation operands, computed
// property keys, and lookup keys alike. A statically known key or index
// resolves only its matching property or element, so a mixed data map with one
// class-string field is judged on that field, while a key that is known but
// absent resolves to undefined and is not a class. A computed key that is not
// statically known conservatively requires every value in the map to satisfy
// the contract. Aggregates whose shape is not fully static (spreads, dynamic
// property keys, holes, reassigned bindings, imports, calls, parameters) pass.
// Object keys, lookup keys and index variables, predicate values, and lookup
// results aliased into another variable are never class sources.
const MAX_RESOLVE_DEPTH = 10;

// `resolveIdentifier` routes identifier operands (aliases) back through the
// caller's binding resolution so concatenations like `pad + "py-2"` stay
// statically known when `pad` is a local constant. TS-only wrappers are
// unwrapped at every recursion point, so wrapped values, aliases, keys, and
// concatenation operands resolve exactly like their bare equivalents.
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

// TypeScript-only wrappers are transparent to static shape resolution. The
// production parser emits these nodes for `as const`, `satisfies`, non-null
// assertions, and type assertions; the ESTree-only rule tests never see them,
// while the TypeScript-parser suite covers them explicitly.
function unwrapTsExpression(node) {
  let current = node;
  while (
    current
    && (current.type === "TSAsExpression"
      || current.type === "TSSatisfiesExpression"
      || current.type === "TSNonNullExpression"
      || current.type === "TSTypeAssertion")
  ) {
    current = current.expression;
  }
  return current;
}

// A fully static property key is a plain identifier/string/number key or a
// computed key whose value is statically known. A dynamic computed key makes
// the map's runtime shape unknowable, so the whole aggregate is skipped rather
// than guessed.
function staticPropertyKey(property, resolveIdentifier) {
  if (property.computed) {
    return isStaticString(property.key, resolveIdentifier);
  }
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "Literal" && (typeof property.key.value === "string" || typeof property.key.value === "number")) {
    return String(property.key.value);
  }
  return null;
}

// Flatten an object/array literal into keyed entries. Spreads, dynamic property
// keys, and holes make the shape not fully static, so they return null.
function staticAggregateEntries(aggregate, resolveIdentifier) {
  if (aggregate.type === "ObjectExpression") {
    const entries = [];
    for (const property of aggregate.properties) {
      if (property.type !== "Property") return null;
      const key = staticPropertyKey(property, resolveIdentifier);
      if (key === null) return null;
      entries.push({ key, value: property.value });
    }
    return entries;
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

// A statically known lookup key is a string literal, an expression-free
// template, a local constant string, or a numeric literal/negative index, with
// TS-only wrappers unwrapped first so `MAP[\"key\" as const]` and wrapped
// indexes resolve like their bare equivalents. It is matched against the
// flattened entry keys, so array indexes and object keys share one
// representation.
function staticLookupKey(node, resolveIdentifier) {
  if (!node) return null;
  const key = unwrapTsExpression(node);
  if (!key) return null;
  if (key.type === "Literal" && typeof key.value === "number") return String(key.value);
  if (
    key.type === "UnaryExpression"
    && key.operator === "-"
    && key.argument?.type === "Literal"
    && typeof key.argument.value === "number"
  ) {
    return String(-key.argument.value);
  }
  return isStaticString(key, resolveIdentifier);
}

function lastMatchingEntry(entries, key) {
  let value = null;
  for (const entry of entries) {
    if (entry.key === key) value = entry.value;
  }
  return value;
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

// Collect class sources inside a className/cn() value, following only
// expression roles whose value can actually become part of the class output:
// results, branch bodies, template interpolations, and concatenations. A
// detached constant in a predicate or data position (logical/conditional
// tests, comparison operands, cn() object condition values, lookup keys) never
// reaches the class string, so those roles are not analyzed. Nested JSX and
// function bodies remain boundaries so unrelated identifiers are never
// visited. Reached member lookups are collected as aggregate class-map
// candidates; resolution decides whether they read a static class map.
function collectClassSources(node, found) {
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
      collectClassSources(node.callee, found);
      if (node.callee.type === "Identifier" && node.callee.name === "cn") {
        for (const argument of node.arguments) collectClassSources(argument, found);
      }
      return;
    }
    case "LogicalExpression":
      // `a && b`: `a` is only a truthiness test — falsy results are skipped by
      // class composition, so its value can never land in the class output.
      // `a || b` / `a ?? b`: a truthy `a` is the result, so it is class data.
      if (node.operator === "&&") {
        collectClassSources(node.right, found);
      } else {
        collectClassSources(node.left, found);
        collectClassSources(node.right, found);
      }
      return;
    case "ConditionalExpression":
      // The test is condition data; the branches supply the class.
      collectClassSources(node.consequent, found);
      collectClassSources(node.alternate, found);
      return;
    case "BinaryExpression":
      // Only `+` can build the class string; comparison and arithmetic
      // operands are data.
      if (node.operator === "+") {
        collectClassSources(node.left, found);
        collectClassSources(node.right, found);
      }
      return;
    case "TemplateLiteral":
      // Interpolations become part of the class string; quasis are literals.
      for (const expression of node.expressions) collectClassSources(expression, found);
      return;
    case "ObjectExpression":
      // `cn({ "bg-primary": cond })`: values are conditions, not classes.
      return;
    case "MemberExpression":
      // A reached lookup (`map[key]`, `map.active`) can be a static class-map
      // read, so it stays a candidate. The computed key/index and the
      // non-computed property name are data, never class sources, and a plain
      // identifier object is resolved by that lookup alone. An object that is
      // itself a member access is still walked so nested lookups like
      // `map[key].trim()` are reached.
      found.add(node);
      if (node.object.type !== "Identifier") collectClassSources(node.object, found);
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
          for (const item of child) collectClassSources(item, found);
        } else if (child && typeof child.type === "string") {
          collectClassSources(child, found);
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
      detachedAggregate:
        "Keep Tailwind utilities inline in className/cn(): '{{name}}' is a local static class map whose lookup resolves to class strings. Inline the utilities at this use site, or move reusable presentation into an owned component variant.",
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

    // Follow a local binding to the object/array literal it holds, through
    // bounded local aliases and TS-only wrappers. A reassigned binding,
    // parameter, import, call, or any other initializer is not a static
    // aggregate.
    function resolveStaticAggregate(identifier, depth = 0) {
      if (depth > MAX_RESOLVE_DEPTH) return null;
      const binding = findBinding(sourceCode, identifier);
      if (!binding || !binding.defs || binding.defs.length === 0) return null;
      const def = binding.defs[0];
      if (def.type !== "Variable" || !def.node || def.node.type !== "VariableDeclarator") return null;
      if (def.node.id === identifier) return null;
      if (binding.references.some((reference) => reference.isWrite() && !reference.init)) return null;
      const init = unwrapTsExpression(def.node.init);
      if (!init) return null;
      if (init.type === "Identifier") return resolveStaticAggregate(init, depth + 1);
      if (init.type === "ObjectExpression" || init.type === "ArrayExpression") return init;
      return null;
    }

    // Resolve a class-producing aggregate lookup to the local aggregate
    // identifier it reads, or null when the object is not a fully static local
    // object/array of non-empty static class strings. A statically known key
    // resolves only its matching property or element — an absent key yields
    // undefined at runtime, so it is not a class source — while a computed
    // dynamic key conservatively requires every value in the map to satisfy
    // the contract.
    function resolveAggregateLookup(member) {
      const object = unwrapTsExpression(member.object);
      if (!object || object.type !== "Identifier") return null;
      const aggregate = resolveStaticAggregate(object);
      if (aggregate === null) return null;
      const entries = staticAggregateEntries(aggregate, resolveStaticString);
      if (entries === null || entries.length === 0) return null;

      let candidates;
      if (!member.computed) {
        if (member.property.type !== "Identifier") return null;
        const selected = lastMatchingEntry(entries, member.property.name);
        if (selected === null) return null;
        candidates = [selected];
      } else {
        const key = staticLookupKey(member.property, resolveStaticString);
        if (key === null) {
          candidates = entries.map((entry) => entry.value);
        } else {
          const selected = lastMatchingEntry(entries, key);
          if (selected === null) return null;
          candidates = [selected];
        }
      }

      for (const candidate of candidates) {
        const staticString = isStaticString(candidate, resolveStaticString);
        if (staticString === null || staticString.trim() === "") return null;
      }
      return object.name;
    }

    function checkValue(value) {
      const sources = new Set();
      collectClassSources(value, sources);
      for (const source of sources) {
        if (reported.has(source)) continue;
        if (source.type === "MemberExpression") {
          const name = resolveAggregateLookup(source);
          if (name === null) continue;
          reported.add(source);
          context.report({
            node: source,
            messageId: "detachedAggregate",
            data: { name },
          });
          continue;
        }
        const staticString = resolveStaticString(source);
        if (staticString === null || staticString.trim() === "") continue;
        reported.add(source);
        context.report({
          node: source,
          messageId: "detached",
          data: { name: source.name },
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
