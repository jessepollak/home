const wrappers = new Set([
  "ParenthesizedExpression",
  "ChainExpression",
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
]);

function unwrap(node) {
  let current = node;
  while (current && wrappers.has(current.type)) current = current.expression;
  return current;
}

function memberIs(node, name) {
  const member = unwrap(node);
  return member?.type === "MemberExpression" && !member.computed
    && member.property.type === "Identifier" && member.property.name === name;
}

function isNamedCall(node, name) {
  const call = unwrap(node);
  if (call?.type !== "CallExpression") return false;
  const callee = unwrap(call.callee);
  return callee?.type === "Identifier" && callee.name === name
    || memberIs(callee, name) && unwrap(callee.object)?.type === "Identifier"
    && unwrap(callee.object).name === "React";
}

function binding(sourceCode, identifier) {
  let scope = sourceCode.getScope(identifier);
  while (scope) {
    const variable = scope.set.get(identifier.name);
    if (variable) return variable;
    scope = scope.upper;
  }
  return null;
}

function immutableDefinition(sourceCode, identifier) {
  const variable = binding(sourceCode, identifier);
  if (!variable || variable.defs.length !== 1
    || variable.references.some((reference) => reference.isWrite() && !reference.init)) return null;
  return variable.defs[0];
}

function resolvedValue(sourceCode, node, seen = new Set()) {
  const expression = unwrap(node);
  if (expression?.type !== "Identifier") return expression;
  const definition = immutableDefinition(sourceCode, expression);
  if (!definition || seen.has(definition)) return expression;
  seen.add(definition);
  if (definition.type === "FunctionName") return definition.node;
  if (definition.type !== "Variable" || definition.node?.id.type !== "Identifier"
    || definition.node.parent?.kind !== "const" || !definition.node.init) return expression;
  return resolvedValue(sourceCode, definition.node.init, seen);
}

function isQueueMicrotask(sourceCode, callee) {
  const resolved = resolvedValue(sourceCode, callee);
  return resolved?.type === "Identifier" && resolved.name === "queueMicrotask"
    && !binding(sourceCode, resolved)?.defs.length;
}

function isPromiseResolve(sourceCode, node) {
  const call = unwrap(node);
  const callee = call?.type === "CallExpression" ? resolvedValue(sourceCode, call.callee) : null;
  return memberIs(callee, "resolve")
    && unwrap(callee.object)?.type === "Identifier"
    && unwrap(callee.object).name === "Promise";
}

function isDeferredCall(sourceCode, node) {
  if (isQueueMicrotask(sourceCode, node.callee)) return true;
  const callee = unwrap(node.callee);
  return memberIs(callee, "then") && isPromiseResolve(sourceCode, resolvedValue(sourceCode, callee.object));
}

function isEffectCall(node) {
  return ["useEffect", "useLayoutEffect", "useInsertionEffect"].some((name) => isNamedCall(node, name));
}

function isInsideEffectCallback(node) {
  let ancestor = node.parent;
  while (ancestor) {
    if (["ArrowFunctionExpression", "FunctionExpression"].includes(ancestor.type)
      && ancestor.parent?.type === "CallExpression"
      && ancestor.parent.arguments[0] === ancestor && isEffectCall(ancestor.parent)) return true;
    ancestor = ancestor.parent;
  }
  return false;
}

function isStateSetter(sourceCode, callee, seen = new Set()) {
  const identifier = unwrap(callee);
  if (identifier?.type !== "Identifier") return false;
  const resolved = resolvedValue(sourceCode, identifier);
  if (resolved?.type === "Identifier"
    && ["setTimeout", "setInterval", "queueMicrotask", "requestAnimationFrame"].includes(resolved.name)
    && !binding(sourceCode, resolved)?.defs.length) return false;
  if (/^set[A-Z]/u.test(identifier.name) && binding(sourceCode, identifier)?.defs.length) return true;
  const definition = immutableDefinition(sourceCode, identifier);
  if (!definition || seen.has(definition) || definition.type !== "Variable") return false;
  seen.add(definition);
  if (definition.node?.id.type === "ArrayPattern" && definition.node.id.elements[1] === definition.name) {
    const source = resolvedValue(sourceCode, definition.node.init);
    return isNamedCall(source, "useState") || isNamedCall(source, "useReducer");
  }
  if (definition.node?.id.type !== "Identifier" || definition.node.parent?.kind !== "const") return false;
  return isStateSetter(sourceCode, definition.node.init, seen);
}

function callsSetter(sourceCode, node) {
  if (!node || typeof node.type !== "string") return false;
  if (node.type === "CallExpression" && isStateSetter(sourceCode, node.callee)) return true;
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent" || !value) continue;
    if (Array.isArray(value)) {
      if (value.some((child) => callsSetter(sourceCode, child))) return true;
    } else if (callsSetter(sourceCode, value)) return true;
  }
  return false;
}

export const noDeferredEffectSetstate = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      rejected: "Do not defer effect state updates; derive the value during render, move the transition to an event handler, adjust state during render, or use a useSyncExternalStore clock. A render-phase adjustment in a server-rendered client component must be gated on a client-mount snapshot, useSyncExternalStore(subscribe, () => true, () => false), or it runs during hydration and mismatches the server tree.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    return {
      CallExpression(node) {
        if (!isInsideEffectCallback(node) || !isDeferredCall(sourceCode, node)) return;
        const argument = node.arguments[0];
        if (isStateSetter(sourceCode, argument)) {
          context.report({ node, messageId: "rejected" });
          return;
        }
        const callback = resolvedValue(sourceCode, argument);
        if (!["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"].includes(callback?.type)
          || !callsSetter(sourceCode, callback.body)) return;
        context.report({ node, messageId: "rejected" });
      },
    };
  },
};
