// Route JSON parsing and abort deadlines through the shared HTTP primitives.
import { manualAbortTimeoutExceptions } from "../policy/http-primitives.mjs";

const wrappers = new Set([
  "ParenthesizedExpression",
  "ChainExpression",
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
]);
const functionTypes = new Set(["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"]);
const optionSchema = [{
  type: "object",
  properties: { allow: { type: "array", items: { type: "string" } } },
  additionalProperties: false,
}];

function unwrap(node) {
  let current = node;
  while (current && wrappers.has(current.type)) current = current.expression;
  return current;
}

function memberIs(node, name) {
  const member = unwrap(node);
  return member?.type === "MemberExpression" && member.computed === false
    && member.property.type === "Identifier" && member.property.name === name;
}

function relativeToAppsWeb(filename) {
  const normalized = String(filename ?? "").replaceAll("\\", "/").replace(/^\.\//u, "");
  const cwd = String(typeof process === "undefined" ? "" : process.cwd()).replaceAll("\\", "/").replace(/\/+$/u, "");
  if (cwd && normalized.startsWith(`${cwd}/`)) return normalized.slice(cwd.length + 1);
  const marker = "/apps/web/";
  const index = normalized.indexOf(marker);
  if (index !== -1) return normalized.slice(index + marker.length);
  if (normalized.startsWith("apps/web/")) return normalized.slice("apps/web/".length);
  return normalized;
}

function allowedFile(context, defaultAllow) {
  const allow = context.options[0]?.allow ?? defaultAllow;
  const filename = relativeToAppsWeb(context.filename);
  return allow instanceof Map ? allow.has(filename) : allow.includes(filename);
}

function identifierVariable(sourceCode, identifier) {
  let scope = sourceCode.getScope(identifier);
  while (scope) {
    const variable = scope.set.get(identifier.name);
    if (variable) return variable;
    scope = scope.upper;
  }
  return null;
}

function platformIdentifier(sourceCode, node, names) {
  const identifier = unwrap(node);
  if (identifier?.type !== "Identifier" || !names.includes(identifier.name)) return false;
  const variable = identifierVariable(sourceCode, identifier);
  return !variable || variable.defs.length === 0;
}

function immutableDefinition(sourceCode, identifier) {
  const variable = identifierVariable(sourceCode, identifier);
  if (!variable || variable.defs.length !== 1
    || variable.references.some((reference) => reference.isWrite() && !reference.init)) return null;
  return variable.defs[0];
}

function resolvedValue(sourceCode, node, seen = new Set(), depth = 0) {
  const expression = unwrap(node);
  if (expression?.type !== "Identifier" || depth >= 5) return expression;
  const definition = immutableDefinition(sourceCode, expression);
  if (!definition || seen.has(definition)) return expression;
  seen.add(definition);
  if (definition.type === "FunctionName") return definition.node;
  if (definition.type !== "Variable" || definition.node?.id.type !== "Identifier"
    || definition.node.parent?.kind !== "const" || !definition.node.init) return expression;
  return resolvedValue(sourceCode, definition.node.init, seen, depth + 1);
}

function scanFunctionBody(sourceCode, body, onCallee) {
  let found = false;
  const visit = (node) => {
    if (found || !node || typeof node.type !== "string" || functionTypes.has(node.type)) return;
    if (node.type === "CallExpression") {
      if (memberIs(node.callee, "abort")) {
        found = true;
        return;
      }
      const callee = resolvedValue(sourceCode, node.callee);
      if (functionTypes.has(callee?.type)) onCallee(callee);
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "parent" || !value) continue;
      if (Array.isArray(value)) {
        for (const child of value) visit(child);
      } else {
        visit(value);
      }
    }
  };
  visit(body);
  return found;
}

// Reachability over the file-local call graph: every function is walked once, so a cycle or a
// repeated fanout cannot re-expand the same subtree, and a result never depends on which timer
// reached the function first.
function reachesAbort(sourceCode, root) {
  const pending = [root];
  const seen = new Set(pending);
  while (pending.length > 0) {
    const current = pending.pop();
    const found = scanFunctionBody(sourceCode, current.body, (callee) => {
      if (seen.has(callee)) return;
      seen.add(callee);
      pending.push(callee);
    });
    if (found) return true;
  }
  return false;
}

function isSetTimeout(sourceCode, node) {
  const callee = unwrap(node);
  if (callee?.type === "Identifier") {
    if (platformIdentifier(sourceCode, callee, ["setTimeout"])) return true;
    if (callee.name !== "setTimeout") return false;
    const definition = identifierVariable(sourceCode, callee)?.defs[0];
    return definition?.type === "ImportBinding" && definition.node.type === "ImportSpecifier"
      && definition.node.imported.name === "setTimeout"
      && ["node:timers", "timers"].includes(definition.parent.source.value);
  }
  if (!memberIs(callee, "setTimeout")) return false;
  return platformIdentifier(sourceCode, callee.object, ["window", "globalThis"]);
}

export const noInlineRequestJson = {
  meta: {
    type: "problem",
    schema: optionSchema,
    messages: {
      rejected: 'Parse request and response JSON through the shared HTTP helpers instead of an inline ".json()" call.',
    },
  },
  create(context) {
    if (allowedFile(context, [])) return {};
    return {
      CallExpression(node) {
        if (node.arguments.length !== 0 || !memberIs(node.callee, "json")) return;
        const object = unwrap(unwrap(node.callee).object);
        if (platformIdentifier(context.sourceCode, object, ["Response", "NextResponse", "JSON"])) return;
        context.report({ node, messageId: "rejected" });
      },
    };
  },
};

export const noManualAbortTimeout = {
  meta: {
    type: "problem",
    schema: optionSchema,
    messages: {
      rejected: "Do not build a local abort deadline with setTimeout; use the shared upstream deadline or AbortSignal.timeout.",
    },
  },
  create(context) {
    if (allowedFile(context, manualAbortTimeoutExceptions)) return {};
    return {
      CallExpression(node) {
        if (!isSetTimeout(context.sourceCode, node.callee)) return;
        const callback = resolvedValue(context.sourceCode, node.arguments[0]);
        if (!functionTypes.has(callback?.type) || !reachesAbort(context.sourceCode, callback)) return;
        context.report({ node, messageId: "rejected" });
      },
    };
  },
};
