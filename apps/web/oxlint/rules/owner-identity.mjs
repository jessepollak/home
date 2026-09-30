const ownerParts = new Set(["address", "smartAccountAddress", "ownerKey", "accountProvider", "chainId"]);
const ownerRoots = new Set(["session", "provisionalSession", "activeSession", "wallet", "account", "verified", "provisional", "seed", "action", "owner", "liveSnapshot", "s", "auth"]);

const transparentNodeTypes = new Set([
  "ChainExpression", "TSAsExpression", "TSInstantiationExpression", "TSNonNullExpression",
  "TSParenthesizedExpression", "TSSatisfiesExpression", "TSTypeAssertion",
]);

function unwrapTransparent(node) {
  let current = node;
  while (current && transparentNodeTypes.has(current.type)) current = current.expression;
  return current;
}

function resolveOwnerRoot(node, sourceCode, seen = new Set()) {
  let current = unwrapTransparent(node);
  while (current?.type === "MemberExpression") {
    if (!current.computed && current.property?.type === "Identifier" && ownerRoots.has(current.property.name)) return current.property;
    current = unwrapTransparent(current.object);
  }
  if (current?.type !== "Identifier") return null;
  if (ownerRoots.has(current.name)) return current;
  let scope = sourceCode.getScope(current);
  while (scope) {
    const variable = scope.set.get(current.name);
    if (variable) {
      if (variable.defs.length !== 1 || seen.has(variable)) return null;
      const definition = variable.defs[0];
      const declarator = definition.node;
      if (definition.type !== "Variable" || declarator?.parent?.kind !== "const") return null;
      if (declarator.id?.type !== "Identifier" || !declarator.init) return null;
      seen.add(variable);
      return resolveOwnerRoot(declarator.init, sourceCode, seen);
    }
    scope = scope.upper;
  }
  return null;
}

function isOwnerRooted(node, sourceCode) {
  return resolveOwnerRoot(node, sourceCode) !== null;
}

function partsIn(node, found = new Set(), sourceCode) {
  if (!node || typeof node !== "object") return found;
  if (node.type === "Identifier" && (node.name === "subject" || ownerParts.has(node.name))) found.add(node.name);
  if (node.type === "MemberExpression" && !node.computed && node.property?.type === "Identifier") {
    if (isOwnerRooted(node, sourceCode) && (node.property.name === "subject" || ownerParts.has(node.property.name))) {
      found.add(node.property.name);
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent" || key === "property" && node.type === "MemberExpression" && !node.computed) continue;
    if (Array.isArray(value)) value.forEach((item) => partsIn(item, found, sourceCode));
    else if (value && typeof value === "object") partsIn(value, found, sourceCode);
  }
  return found;
}

function isOwnerTuple(parts) {
  return parts.has("subject") && [...ownerParts].some((name) => parts.has(name));
}

function arrayReceiver(sourceCode, receiver, seen = new Set()) {
  const node = unwrapTransparent(receiver);
  if (!node) return null;
  if (node.type === "ArrayExpression") return node;
  if (node.type === "CallExpression" && node.callee?.type === "MemberExpression" &&
      !node.callee.computed && node.callee.property?.name === "map") {
    return arrayReceiver(sourceCode, node.callee.object, seen);
  }
  if (node.type !== "Identifier") return null;
  let scope = sourceCode.getScope(node);
  while (scope) {
    const variable = scope.set.get(node.name);
    if (variable) {
      if (variable.defs.length !== 1 || seen.has(variable)) return null;
      const definition = variable.defs[0];
      const declarator = definition.node;
      if (definition.type !== "Variable" || declarator?.parent?.kind !== "const") return null;
      seen.add(variable);
      return arrayReceiver(sourceCode, declarator.init, seen);
    }
    scope = scope.upper;
  }
  return null;
}

export const ownerIdentityHelper = {
  meta: {
    type: "problem",
    schema: [],
    messages: { useHelper: "Build owner identity through client/account/owner-keys.ts instead of assembling a subject tuple here." },
  },
  create(context) {
    return {
      TemplateLiteral(node) {
        if (isOwnerTuple(partsIn(node.expressions, new Set(), context.sourceCode))) context.report({ node, messageId: "useHelper" });
      },
      BinaryExpression(node) {
        if (node.operator === "+" && isOwnerTuple(partsIn([node.left, node.right], new Set(), context.sourceCode))) {
          context.report({ node, messageId: "useHelper" });
        }
      },
      CallExpression(node) {
        if (node.callee?.type !== "MemberExpression" || node.callee.computed) return;
        if (node.callee.property?.name === "concat") {
          if (isOwnerTuple(partsIn([node.callee.object, ...node.arguments], new Set(), context.sourceCode))) {
            context.report({ node, messageId: "useHelper" });
          }
          return;
        }
        if (node.callee.property?.name !== "join") return;
        const array = arrayReceiver(context.sourceCode, node.callee.object);
        if (array && isOwnerTuple(partsIn(array.elements, new Set(), context.sourceCode))) context.report({ node, messageId: "useHelper" });
      },
    };
  },
};
