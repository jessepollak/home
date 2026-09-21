const instrumentationModules = new Set([
  "@/server/observability/log",
  "@/client/observability/client-reporter",
  "@/server/observability/client-errors",
  "@/client/observability/perf-marks",
  "@/client/observability/auth-performance",
  "@/client/account/auth-diagnostics",
]);

function sourceValue(node) {
  if (node?.type === "Literal" || node?.type === "StringLiteral") return node.value;
  return undefined;
}

function filenameIsInstrumentation(context) {
  const filename = String(context.filename ?? "").replaceAll("\\", "/");
  return [...instrumentationModules].some((moduleName) =>
    filename.endsWith(`${moduleName.slice(2)}.ts`) || filename.endsWith(`${moduleName.slice(2)}.tsx`));
}

function isWithin(node, ancestor) {
  let current = node;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

function isIsolatedCall(node) {
  const catchMember = node.parent;
  const catchCall = catchMember?.parent;
  if (catchMember?.type === "MemberExpression" && catchMember.object === node
    && !catchMember.computed && catchMember.property.type === "Identifier"
    && catchMember.property.name === "catch" && catchCall?.type === "CallExpression"
    && catchCall.callee === catchMember && catchCall.parent?.type === "UnaryExpression"
    && catchCall.parent.operator === "void") return true;

  let current = node;
  while (current?.parent) {
    const parent = current.parent;
    if (parent.type === "TryStatement" && parent.handler && isWithin(node, parent.block)) return true;
    if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(parent.type)) break;
    current = parent;
  }
  return false;
}

export const isolateInstrumentationCalls = {
  meta: {
    type: "problem",
    schema: [{ type: "object", properties: { safeHelpers: { type: "array", items: { type: "string" } } }, additionalProperties: false }],
    messages: {
      rejected: "Instrumentation calls must be isolated in try/catch or `void promise.catch(...)` so reporting failure cannot change application behavior.",
    },
  },
  create(context) {
    if (filenameIsInstrumentation(context)) return {};
    const safeHelpers = new Set(context.options[0]?.safeHelpers ?? []);
    const instrumentationBindings = new Map();
    return {
      ImportDeclaration(node) {
        if (!instrumentationModules.has(sourceValue(node.source))) return;
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier") continue;
          const name = specifier.imported.type === "Identifier"
            ? specifier.imported.name
            : specifier.imported.value;
          instrumentationBindings.set(specifier.local.name, name);
        }
      },
      CallExpression(node) {
        if (node.callee.type !== "Identifier") return;
        const imported = instrumentationBindings.get(node.callee.name);
        if (imported && !safeHelpers.has(imported) && !isIsolatedCall(node)) {
          context.report({ node, messageId: "rejected" });
        }
      },
    };
  },
};

function callName(node) {
  if (node.callee.type === "Identifier") return node.callee.name;
  if (node.callee.type === "MemberExpression" && !node.callee.computed
    && node.callee.property.type === "Identifier") return node.callee.property.name;
  return null;
}

function returnsHandledValue(node) {
  if (node.type !== "ReturnStatement" || !node.argument) return false;
  return !(node.argument.type === "Identifier" && node.argument.name === "undefined")
    && !(node.argument.type === "Literal" && node.argument.value === null);
}

function assignsOuterValue(sourceCode, catchClause, node) {
  if (node.type !== "AssignmentExpression" || node.left.type !== "Identifier") return false;
  let scope = sourceCode.getScope(node.left);
  while (scope) {
    const variable = scope.set.get(node.left.name);
    if (variable) {
      const declaredInside = variable.identifiers.some((identifier) => isWithin(identifier, catchClause));
      return !declaredInside && variable.references.some((reference) => reference.identifier.start > catchClause.end);
    }
    scope = scope.upper;
  }
  return false;
}

function catchHasDisposition(sourceCode, node, reportingHelpers) {
  const recoveryCall = /^(?:set[A-Z]|on[A-Z]|dispatch|resolve|reject|abort|cancel|cleanup|clear|release|remove|reset|invalidate)/u;
  const stack = [...node.body.body];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (current.type === "ThrowStatement" || returnsHandledValue(current)
      || assignsOuterValue(sourceCode, node, current)) return true;
    if (current.type === "CallExpression") {
      const name = callName(current);
      if (name && (reportingHelpers.has(name) || recoveryCall.test(name))) return true;
    }
    if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(current.type)) continue;
    for (const value of Object.values(current)) {
      if (!value || value === current.parent) continue;
      if (Array.isArray(value)) {
        for (const child of value) if (child && typeof child.type === "string") stack.push(child);
      } else if (typeof value.type === "string") stack.push(value);
    }
  }
  return false;
}

export const noSilentCatch = {
  meta: {
    type: "problem",
    schema: [{ type: "object", properties: { reportingHelpers: { type: "array", items: { type: "string" } } }, additionalProperties: false }],
    messages: {
      empty: "Empty catch clauses are forbidden; return or throw a typed error result, or report the failure.",
      silent: "Caught failures must be rethrown, returned as a typed error result, or passed to an approved reporting helper.",
    },
  },
  create(context) {
    if (filenameIsInstrumentation(context)) return {};
    const reportingHelpers = new Set(context.options[0]?.reportingHelpers ?? []);
    return {
      CatchClause(node) {
        if (node.body.body.length === 0) {
          context.report({ node, messageId: "empty" });
        } else if (!catchHasDisposition(context.sourceCode, node, reportingHelpers)) {
          context.report({ node, messageId: "silent" });
        }
      },
    };
  },
};
