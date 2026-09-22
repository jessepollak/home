const instrumentationModules = new Set([
  "@/server/observability/log",
  "@/client/observability/client-reporter",
  "@/server/observability/client-errors",
  "@/server/observability/client-performance",
  "@/server/observability/on-request-error",
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
    if (parent.type === "TryStatement" && parent.handler && isWithin(node, parent.block)) {
      return node.parent?.type === "AwaitExpression";
    }
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

const undefinedValueWrappers = new Set([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
]);

function isUndefinedValue(node) {
  let current = node;
  while (current && undefinedValueWrappers.has(current.type)) current = current.expression;
  return (current?.type === "Identifier" && current.name === "undefined")
    || (current?.type === "UnaryExpression" && current.operator === "void");
}

function findVariable(state, identifier) {
  let scope = state.sourceCode.getScope(identifier);
  while (scope) {
    const variable = scope.set.get(identifier.name);
    if (variable) return variable;
    scope = scope.upper;
  }
  return null;
}

function assignsOuterValue(state, node) {
  if (node.type !== "AssignmentExpression" || node.left.type !== "Identifier"
    || isUndefinedValue(node.right)) return false;
  const variable = findVariable(state, node.left);
  if (!variable) return false;
  const declaredInside = variable.identifiers.some((identifier) => isWithin(identifier, state.catchClause));
  return !declaredInside && variable.references.some((reference) =>
    reference.identifier.start > state.catchClause.end && reference.isRead());
}

function walkAssignments(node, visit) {
  if (!node || typeof node !== "object") return;
  if (node.type === "AssignmentExpression") visit(node);
  if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type)) return;
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent" || !value) continue;
    if (Array.isArray(value)) {
      for (const child of value) walkAssignments(child, visit);
    } else if (typeof value === "object") {
      walkAssignments(value, visit);
    }
  }
}

function retainsPreInitializedFallback(state) {
  const tryStatement = state.catchClause.parent;
  if (tryStatement?.type !== "TryStatement") return false;
  const undefinedAssignments = new Set();
  const candidates = [];
  walkAssignments(tryStatement.block, (assignment) => {
    if (assignment.left.type !== "Identifier") return;
    const variable = findVariable(state, assignment.left);
    if (!variable) return;
    if (isUndefinedValue(assignment.right)) {
      undefinedAssignments.add(variable);
      return;
    }
    candidates.push(variable);
  });
  return candidates.some((variable) => {
    if (undefinedAssignments.has(variable)) return false;
    const identifier = variable.identifiers[0];
    const declarator = identifier?.parent;
    const declaration = declarator?.parent;
    if (declarator?.type !== "VariableDeclarator" || declaration?.type !== "VariableDeclaration"
      || !["let", "var"].includes(declaration.kind) || !declarator.init
      || isUndefinedValue(declarator.init) || !(declarator.start < tryStatement.start)) return false;
    return variable.references.some((reference) =>
      reference.identifier.start > tryStatement.end && reference.isRead());
  });
}

const recoveryCall = /^(?:set[A-Z]|on[A-Z]|dispatch|resolve|reject|abort|cancel|cleanup|clear|release|remove|reset|invalidate|delete)/u;
const transparentExpression = new Set([
  "AwaitExpression",
  "ChainExpression",
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
]);

function localHelperDisposes(state, name) {
  if (state.stack.has(name)) return false;
  const bodies = state.localFunctions.get(name);
  if (!bodies) return false;
  state.stack.add(name);
  const disposes = bodies.every((body) => body.type === "BlockStatement"
    ? blockOutcomes(state, body, true) === 0
    : expressionHasDisposition(state, body));
  state.stack.delete(name);
  return disposes;
}

function expressionHasDisposition(state, node) {
  if (!node) return false;
  if (node.type === "AssignmentExpression" && assignsOuterValue(state, node)) return true;
  if (node.type === "CallExpression" || node.type === "NewExpression") {
    const name = callName(node);
    if (!node.optional && name && (state.reportingHelpers.has(name) || recoveryCall.test(name))) return true;
    if (!node.optional && node.callee.type === "Identifier"
      && localHelperDisposes(state, node.callee.name)) return true;
    return !node.optional && node.arguments.some((argument) =>
      argument.type !== "SpreadElement"
        ? expressionHasDisposition(state, argument)
        : expressionHasDisposition(state, argument.argument));
  }
  if (transparentExpression.has(node.type)) {
    return expressionHasDisposition(state, node.expression ?? node.argument);
  }
  if (node.type === "UnaryExpression" && node.operator === "void") {
    return expressionHasDisposition(state, node.argument);
  }
  if (node.type === "SequenceExpression") {
    return node.expressions.some((expression) => expressionHasDisposition(state, expression));
  }
  if (node.type === "ConditionalExpression") {
    return expressionHasDisposition(state, node.test)
      || (expressionHasDisposition(state, node.consequent)
        && expressionHasDisposition(state, node.alternate));
  }
  if (node.type === "LogicalExpression") {
    return expressionHasDisposition(state, node.left)
      || (expressionHasDisposition(state, node.right)
        && node.operator === "??" && node.left.type === "Literal" && node.left.value == null);
  }
  if (node.type === "AssignmentExpression") {
    return expressionHasDisposition(state, node.right);
  }
  if (node.type === "BinaryExpression") {
    return expressionHasDisposition(state, node.left) || expressionHasDisposition(state, node.right);
  }
  if (node.type === "ArrayExpression") {
    return node.elements.some((element) => element
      && expressionHasDisposition(state, element.argument ?? element));
  }
  if (node.type === "ObjectExpression") {
    return node.properties.some((property) => property.type === "SpreadElement"
      ? expressionHasDisposition(state, property.argument)
      : expressionHasDisposition(state, property.value));
  }
  return false;
}

const fallsThrough = 1;
const exitsWithoutDisposition = 2;

function statementOutcomes(state, node, inHelper) {
  if (node.type === "ReturnStatement") {
    return inHelper ? exitsWithoutDisposition : node.argument ? 0 : exitsWithoutDisposition;
  }
  if (node.type === "ThrowStatement") return 0;
  if (node.type === "BlockStatement") {
    return blockOutcomes(state, node, inHelper);
  }
  if (node.type === "TryStatement") {
    const block = blockOutcomes(state, node.block, inHelper);
    const handler = node.handler
      ? blockOutcomes(state, node.handler.body, inHelper)
      : exitsWithoutDisposition;
    const combined = block | handler;
    return node.finalizer
      ? combined | (blockOutcomes(state, node.finalizer, inHelper) & exitsWithoutDisposition)
      : combined;
  }
  if (node.type === "ExpressionStatement") {
    return expressionHasDisposition(state, node.expression) ? 0 : fallsThrough;
  }
  if (node.type === "VariableDeclaration") {
    return node.declarations.some((declaration) => expressionHasDisposition(state, declaration.init))
      ? 0
      : fallsThrough;
  }
  if (node.type === "IfStatement") {
    if (expressionHasDisposition(state, node.test)) return 0;
    const consequent = statementOutcomes(state, node.consequent, inHelper);
    const alternate = node.alternate ? statementOutcomes(state, node.alternate, inHelper) : fallsThrough;
    return consequent | alternate;
  }
  if (node.type === "LabeledStatement" || node.type === "WithStatement") {
    return statementOutcomes(state, node.body, inHelper);
  }
  if (node.type === "DoWhileStatement") {
    return statementOutcomes(state, node.body, inHelper);
  }
  return fallsThrough;
}

function blockOutcomes(state, block, inHelper) {
  let outcomes = fallsThrough;
  for (const statement of block.body) {
    if (!(outcomes & fallsThrough)) break;
    outcomes = (outcomes & exitsWithoutDisposition) | statementOutcomes(state, statement, inHelper);
  }
  return outcomes;
}

function catchHasDisposition(state, node) {
  return blockOutcomes(state, node.body, false) === 0 || retainsPreInitializedFallback(state);
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
    const localFunctions = new Map();
    const catchClauses = [];
    const addLocalFunction = (name, body) => {
      const bodies = localFunctions.get(name) ?? [];
      bodies.push(body);
      localFunctions.set(name, bodies);
    };
    return {
      FunctionDeclaration(node) {
        if (node.id && node.body) addLocalFunction(node.id.name, node.body);
      },
      VariableDeclarator(node) {
        if (node.id.type !== "Identifier" || !node.init) return;
        if (node.init.type === "ArrowFunctionExpression" || node.init.type === "FunctionExpression") {
          addLocalFunction(node.id.name, node.init.body);
        }
      },
      CatchClause(node) {
        catchClauses.push(node);
      },
      "Program:exit"() {
        for (const node of catchClauses) {
          const state = {
            sourceCode: context.sourceCode,
            catchClause: node,
            reportingHelpers,
            localFunctions,
            stack: new Set(),
          };
          if (catchHasDisposition(state, node)) continue;
          context.report({ node, messageId: node.body.body.length === 0 ? "empty" : "silent" });
        }
      },
    };
  },
};
