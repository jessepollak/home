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
    && staticMemberName(catchMember) === "catch" && catchCall?.type === "CallExpression"
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
  const callee = unwrapTransparent(node.callee);
  if (callee?.type === "Identifier") return callee.name;
  return staticMemberName(callee);
}

const transparentWrappers = new Set([
  "ChainExpression",
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
  "TSInstantiationExpression",
]);

function unwrapTransparent(node) {
  let current = node;
  while (current && transparentWrappers.has(current.type)) current = current.expression;
  return current;
}

function staticMemberName(member) {
  if (member?.type !== "MemberExpression") return null;
  const property = unwrapTransparent(member.property);
  if (!member.computed) return property?.type === "Identifier" ? property.name : null;
  if (property?.type === "TemplateLiteral" && property.expressions.length === 0) {
    return property.quasis[0]?.value?.cooked ?? null;
  }
  const value = sourceValue(property);
  return typeof value === "string" ? value : null;
}

function isUndefinedValue(node) {
  let current = node;
  while (current && transparentWrappers.has(current.type)) current = current.expression;
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

function importedReportingHelper(state, node) {
  if (state.reportingHelpers.size === 0 || state.reportingModules.size === 0) return null;
  const callee = unwrapTransparent(node.callee);
  if (callee?.type !== "Identifier") return null;
  const variable = findVariable(state, callee);
  const binding = variable?.defs.find((definition) =>
    definition.type === "ImportBinding"
      && state.reportingHelpers.has(definition.node?.imported?.name)
      && state.reportingModules.has(sourceValue(definition.parent?.source)));
  return binding ? { name: binding.node.imported.name, module: sourceValue(binding.parent.source) } : null;
}

function enclosingFunction(node) {
  let current = node;
  while (current) {
    if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(current.type)) return current;
    current = current.parent;
  }
  return null;
}

function enclosingStatement(node) {
  let current = node;
  while (current.parent && !["Program", "BlockStatement", "StaticBlock", "SwitchCase"].includes(current.parent.type)) current = current.parent;
  return current;
}

function readByLaterClosure(rejectionCall, read) {
  const callerFunction = enclosingFunction(rejectionCall);
  let closure = null;
  for (let current = enclosingFunction(read); current && current !== callerFunction;
    current = enclosingFunction(current.parent)) closure = current;
  if (!closure || closure.type === "FunctionDeclaration"
    || (callerFunction && !isWithin(closure, callerFunction))) return false;
  return closure.start > enclosingStatement(rejectionCall).end;
}

function observesOuterValue(state, reference, span) {
  const read = reference.identifier;
  if (!reference.isRead() || read.start <= span.end) return false;
  if (!state.rejectionCall) return true;
  if (readByLaterClosure(state.rejectionCall, read)) return true;
  let current = state.rejectionCall;
  while (current.parent) {
    const parent = current.parent;
    if (transparentWrappers.has(parent.type)) {
      current = parent;
      continue;
    }
    if (parent.type === "AwaitExpression" && parent.argument === current) {
      return read.start > parent.end && enclosingFunction(read) === enclosingFunction(parent);
    }
    if (parent.type !== "MemberExpression" || parent.object !== current) return false;
    const method = staticMemberName(parent);
    const call = parent.parent;
    if (!["then", "finally", "catch"].includes(method)
      || call?.type !== "CallExpression" || call.callee !== parent) return false;
    const callback = unwrapTransparent(call.arguments[0]);
    if ((method === "then" || method === "finally")
      && (callback?.type === "ArrowFunctionExpression" || callback?.type === "FunctionExpression")
      && !callback.generator && enclosingFunction(read) === callback) return true;
    current = call;
  }
  return false;
}

function assignsOuterValue(state, node) {
  if (node.type !== "AssignmentExpression" || node.left.type !== "Identifier"
    || isUndefinedValue(node.right)) return false;
  const variable = findVariable(state, node.left);
  if (!variable) return false;
  const declaredInside = variable.identifiers.some((identifier) => isWithin(identifier, state.catchClause));
  return !declaredInside && variable.references.some((reference) =>
    observesOuterValue(state, reference, state.catchClause));
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

function retainsPreInitializedFallback(state, protectedRegion, statementSpan) {
  if (!protectedRegion) return false;
  const undefinedAssignments = new Set();
  const candidates = [];
  walkAssignments(protectedRegion, (assignment) => {
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
      || isUndefinedValue(declarator.init) || !(declarator.start < statementSpan.start)) return false;
    return variable.references.some((reference) =>
      observesOuterValue(state, reference, statementSpan));
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

function localHelperDisposes(state, identifier) {
  if (state.skipHelpers) return false;
  const name = identifier.name;
  if (state.stack.has(name)) {
    state.cycleProbe.hits += 1;
    return false;
  }
  const entries = state.localFunctions.get(name);
  if (!entries) return false;
  const variable = findVariable(state, identifier);
  if (!variable) return false;
  const owned = entries.filter((entry) => variable.defs.some((definition) =>
    (definition.type === "FunctionName" || definition.type === "Variable")
      && definition.node === entry.node));
  if (owned.length === 0 || owned.some((entry) => entry.body.parent?.generator === true)) return false;
  state.stack.add(name);
  const disposes = owned.every((entry) => entry.body.type === "BlockStatement"
    ? blockOutcomes(state, entry.body, true) === 0
    : !(state.requireReport && evaluatesAbruptCompletion(entry.body)) && expressionHasDisposition(state, entry.body));
  state.stack.delete(name);
  return disposes;
}

function telemetryCallbackDisposes(state, node) {
  const callback = unwrapTransparent(node.arguments[0]);
  if (callback?.type !== "ArrowFunctionExpression" && callback?.type !== "FunctionExpression") return false;
  if (callback.generator) return false;
  const telemetryState = { ...state, requireTelemetrySink: true, telemetryCallback: state.telemetryCallback ?? callback };
  return callback.body.type === "BlockStatement"
    ? blockOutcomes(telemetryState, callback.body, false) === 0
    : !(telemetryState.requireReport && evaluatesAbruptCompletion(callback.body)) && expressionHasDisposition(telemetryState, callback.body);
}

const telemetryReportingImports = new Map([
  ["@/server/observability/log", new Set(["emitServerEvent", "writeObservabilityEvent"])],
  ["@/client/observability/client-reporter", new Set(["reportClientError"])],
]);

function isTelemetrySinkCall(state, node, callee) {
  if (callee?.type !== "Identifier" || node.arguments.length === 0) return false;
  const variable = findVariable(state, callee);
  if (!variable || variable.references.some((reference) => reference.isWrite())) return false;
  return variable.defs.some((definition) => definition.type === "Parameter"
    && isWithin(state.telemetryCallback, definition.node)
    && !isWithin(definition.node, state.telemetryCallback)
    && telemetryDelegationBody(state, definition.node));
}

function telemetryDelegationBody(state, fn) {
  const body = fn?.body;
  if (!body) return false;
  if (body.type !== "BlockStatement") return delegatedTelemetryCall(state, body);
  if (body.body.length !== 1) return false;
  const [statement] = body.body;
  if (statement.type === "ExpressionStatement") return delegatedTelemetryCall(state, statement.expression);
  return false;
}

function delegatedTelemetryCall(state, expression) {
  const call = unwrapTransparent(expression);
  if (call?.type !== "CallExpression") return false;
  const imported = importedReportingHelper(state, call);
  if (imported?.name !== "observeSafely" || imported.module !== "@/server/observability/log") return false;
  return call.arguments.some((argument) => argument?.type !== "SpreadElement"
    && isWithin(state.telemetryCallback, argument));
}

function finalizerInterruptsReturn(node) {
  if (!node || typeof node !== "object") return false;
  if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type)) return false;
  if (visiblyDivergentLoop(node)) return true;
  if (node.type === "ReturnStatement" || node.type === "AwaitExpression"
    || node.type === "BreakStatement" || node.type === "ContinueStatement"
    || node.type === "ThrowStatement"
    || (node.type === "VariableDeclaration" && (node.kind === "using" || node.kind === "await using"))
    || (node.type === "ForOfStatement" && node.await)) return true;
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent" || !value) continue;
    if (key === "value" && ["MethodDefinition", "PropertyDefinition", "AccessorProperty"].includes(node.type)) continue;
    if (Array.isArray(value)) {
      if (value.some(finalizerInterruptsReturn)) return true;
    } else if (typeof value === "object" && finalizerInterruptsReturn(value)) {
      return true;
    }
  }
  return false;
}

function hasInterruptingFinalizer(node) {
  let current = node;
  while (current.parent) {
    const parent = current.parent;
    if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(parent.type)) break;
    if (parent.type === "TryStatement" && parent.finalizer && parent.finalizer !== current
      && finalizerInterruptsReturn(parent.finalizer)) return true;
    current = parent;
  }
  return false;
}

function blockDeclaresUsing(block) {
  return block.body.some((statement) => statement.type === "VariableDeclaration"
    && (statement.kind === "using" || statement.kind === "await using"));
}

function declaresUsing(node) {
  return node?.type === "VariableDeclaration" && (node.kind === "using" || node.kind === "await using");
}

function loopHeaderDeclaresUsing(loop, body) {
  if (loop.body !== body) return false;
  if (loop.type === "ForStatement") return declaresUsing(loop.init);
  return (loop.type === "ForOfStatement" || loop.type === "ForInStatement") && declaresUsing(loop.left);
}

function pendingUsingScope(node) {
  let current = node;
  while (current.parent) {
    const parent = current.parent;
    if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(parent.type)) break;
    if (parent.type === "BlockStatement" && blockDeclaresUsing(parent)) return true;
    if (loopHeaderDeclaresUsing(parent, current)) return true;
    current = parent;
  }
  return false;
}

function surfacedTelemetryWrite(node) {
  let current = node;
  while (current.parent) {
    const parent = current.parent;
    if (parent.type === "AwaitExpression") return true;
    if (parent.type === "ReturnStatement") return !hasInterruptingFinalizer(parent) && !pendingUsingScope(parent);
    if ((parent.type === "ArrowFunctionExpression" || parent.type === "FunctionExpression")
      && parent.body === current) return true;
    if (transparentWrappers.has(parent.type)) {
      current = parent;
      continue;
    }
    if (parent.type === "ConditionalExpression"
      && (parent.consequent === current || parent.alternate === current)) {
      current = parent;
      continue;
    }
    if (parent.type === "SequenceExpression" && parent.expressions.at(-1) === current) {
      current = parent;
      continue;
    }
    if (parent.type === "LogicalExpression" && (parent.right === current
      || (parent.left === current && (parent.operator === "||" || parent.operator === "??")))) {
      current = parent;
      continue;
    }
    return false;
  }
  return false;
}

function expressionHasDisposition(state, node) {
  if (!node) return false;
  if (!state.requireTelemetrySink && !state.requireReport && node.type === "AssignmentExpression" && assignsOuterValue(state, node)) return true;
  if (node.type === "CallExpression" || node.type === "NewExpression") {
    const name = callName(node);
    const imported = node.type === "CallExpression" ? importedReportingHelper(state, node) : null;
    if (!node.optional && imported?.name === "observeSafely"
      && imported.module === "@/server/observability/log") return telemetryCallbackDisposes(state, node);
    if (!node.optional && imported && (!state.requireTelemetrySink
      || (node.arguments.length > 0 && telemetryReportingImports.get(imported.module)?.has(imported.name)
        && surfacedTelemetryWrite(node)))) return true;
    const callee = unwrapTransparent(node.callee);
    if (!node.optional && callee?.type === "Identifier"
      && localHelperDisposes(state, callee)
      && (!state.requireTelemetrySink || surfacedTelemetryWrite(node))) return true;
    if (!node.optional && state.requireTelemetrySink) {
      return node.type === "CallExpression" && isTelemetrySinkCall(state, node, callee)
        && surfacedTelemetryWrite(node);
    }
    if (state.requireReport) return false;
    if (!node.optional && name && recoveryCall.test(name)) return true;
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
const diverges = 4;
const telemetryCallbackIds = new WeakMap();
let nextTelemetryCallbackId = 1;

function outcomeMemoKey(state, inHelper) {
  let callbackId = 0;
  if (state.telemetryCallback) {
    callbackId = telemetryCallbackIds.get(state.telemetryCallback);
    if (callbackId === undefined) {
      callbackId = nextTelemetryCallbackId++;
      telemetryCallbackIds.set(state.telemetryCallback, callbackId);
    }
  }
  return `${Boolean(state.requireReport)}:${Boolean(state.requireTelemetrySink)}:${Boolean(state.skipHelpers)}:${Boolean(inHelper)}:${callbackId}`;
}

function containsLoopJump(node) {
  if (!node || typeof node !== "object") return false;
  if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type)) return false;
  if (node.type === "BreakStatement" || node.type === "ContinueStatement") return true;
  return Object.entries(node).some(([key, value]) => {
    if (key === "parent" || !value) return false;
    return Array.isArray(value) ? value.some(containsLoopJump) : typeof value === "object" && containsLoopJump(value);
  });
}

function visiblyDivergentLoop(node) {
  if (!["WhileStatement", "DoWhileStatement", "ForStatement"].includes(node.type)) return false;
  const alwaysRuns = (node.type === "ForStatement" && !node.test)
    || (node.test?.type === "Literal" && node.test.value === true);
  return alwaysRuns && !containsLoopJump(node.body);
}

function containsDivergentLoop(state, node) {
  return state.divergentSubtrees.has(node);
}

function armsMayDiverge(state, node, inHelper) {
  if (!containsDivergentLoop(state, node.block) && !(node.handler && containsDivergentLoop(state, node.handler.body))) return false;
  const probeState = { ...state, skipHelpers: true };
  const block = blockOutcomes(probeState, node.block, inHelper);
  const handler = node.handler
    ? blockOutcomes(probeState, node.handler.body, inHelper)
    : exitsWithoutDisposition;
  return Boolean((block | handler) & diverges);
}

function statementOutcomes(state, node, inHelper) {
  const key = outcomeMemoKey(state, inHelper);
  const memo = state.memo.get(node);
  if (memo?.has(key)) return memo.get(key);
  const hits = state.cycleProbe.hits;
  const outcomes = computeStatementOutcomes(state, node, inHelper);
  if (state.cycleProbe.hits === hits) {
    const entries = memo ?? new Map();
    entries.set(key, outcomes);
    state.memo.set(node, entries);
  }
  return outcomes;
}

function computeStatementOutcomes(state, node, inHelper) {
  if (state.requireReport && evaluatesAbruptCompletion(node)) return exitsWithoutDisposition;
  if (node.type === "ReturnStatement") {
    if (state.requireTelemetrySink || state.requireReport) {
      return expressionHasDisposition(state, node.argument) ? 0 : exitsWithoutDisposition;
    }
    return inHelper ? exitsWithoutDisposition : node.argument ? 0 : exitsWithoutDisposition;
  }
  if (node.type === "ThrowStatement") return state.requireTelemetrySink || state.requireReport ? exitsWithoutDisposition : 0;
  if (node.type === "BlockStatement") {
    return blockOutcomes(state, node, inHelper);
  }
  if (node.type === "TryStatement") {
    if (!state.requireTelemetrySink && !state.requireReport && node.finalizer
      && blockAlwaysThrows(state, node.finalizer, inHelper)) {
      return armsMayDiverge(state, node, inHelper) ? diverges : 0;
    }
    const finalizer = node.finalizer ? blockOutcomes(state, node.finalizer, inHelper) : null;
    if (finalizer === 0 && finalizerReports(state, node, inHelper)) {
      return armsMayDiverge(state, node, inHelper) ? diverges : 0;
    }
    const block = blockOutcomes(state, node.block, inHelper);
    const handler = node.handler
      ? blockOutcomes(state, node.handler.body, inHelper)
      : exitsWithoutDisposition;
    const combined = block | handler;
    return finalizer === null
      ? combined
      : combined | (finalizer & ~fallsThrough);
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
  if (visiblyDivergentLoop(node)) {
    const body = statementOutcomes(state, node.body, inHelper);
    return (body & ~fallsThrough) | (body & fallsThrough ? diverges : 0);
  }
  if (node.type === "DoWhileStatement") {
    return statementOutcomes(state, node.body, inHelper);
  }
  if (state.requireReport) return exitsWithoutDisposition;
  return fallsThrough;
}

function statementAlwaysThrows(state, node, inHelper) {
  if (node.type === "ThrowStatement") return true;
  if (node.type === "BlockStatement") return blockAlwaysThrows(state, node, inHelper);
  if (node.type === "IfStatement") {
    return Boolean(node.alternate)
      && statementAlwaysThrows(state, node.consequent, inHelper)
      && statementAlwaysThrows(state, node.alternate, inHelper);
  }
  if (node.type === "LabeledStatement" || node.type === "WithStatement" || node.type === "DoWhileStatement") {
    return statementAlwaysThrows(state, node.body, inHelper);
  }
  if (node.type === "TryStatement") {
    if (node.finalizer && containsDivergentLoop(state, node.finalizer)
      && (blockOutcomes({ ...state, skipHelpers: true }, node.finalizer, inHelper) & diverges)) return false;
    if (node.finalizer && blockAlwaysThrows(state, node.finalizer, inHelper)) {
      if (!armsMayDiverge(state, node, inHelper)) return true;
    }
    return Boolean(node.handler)
      && statementAlwaysThrows(state, node.block, inHelper)
      && statementAlwaysThrows(state, node.handler.body, inHelper);
  }
  return false;
}

function blockAlwaysThrows(state, block, inHelper) {
  for (const statement of block.body) {
    if (statementAlwaysThrows(state, statement, inHelper)) return true;
    if (!(statementOutcomes(state, statement, inHelper) & fallsThrough)) return false;
  }
  return false;
}

function blockOutcomes(state, block, inHelper) {
  let outcomes = fallsThrough;
  for (const statement of block.body) {
    if (!(outcomes & fallsThrough)) break;
    outcomes = (outcomes & ~fallsThrough) | statementOutcomes(state, statement, inHelper);
  }
  return outcomes;
}

function finalizerReports(state, node, inHelper) {
  const arms = node.handler ? [node.block, node.handler.body] : [node.block];
  if (arms.some((block) => armAbruptCompletion(block))) return false;
  if (node.finalizer.body.some((statement) =>
    !(statement.type === "VariableDeclaration" && (statement.kind === "using" || statement.kind === "await using"))
    && evaluatesResourceDeclaration(statement))) return false;
  if (state.requireReport) return true;
  return blockOutcomes({ ...state, requireReport: true }, node.finalizer, inHelper) === 0;
}

function evaluatesResourceDeclaration(node) {
  if (!node || typeof node !== "object") return false;
  if (node.type === "VariableDeclaration" && (node.kind === "using" || node.kind === "await using")) return true;
  if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type)) return false;
  return Object.entries(node).some(([key, value]) => {
    if (key === "parent" || !value) return false;
    return Array.isArray(value) ? value.some(evaluatesResourceDeclaration) : typeof value === "object" && evaluatesResourceDeclaration(value);
  });
}

function evaluatesAbruptCompletion(node) {
  if (!node || typeof node !== "object") return false;
  if (node.type === "ClassExpression" || node.type === "ClassDeclaration" || node.type === "YieldExpression") return true;
  if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type)) return false;
  return Object.entries(node).some(([key, value]) => {
    if (key === "parent" || !value) return false;
    return Array.isArray(value) ? value.some(evaluatesAbruptCompletion) : typeof value === "object" && evaluatesAbruptCompletion(value);
  });
}

function armAbruptCompletion(node) {
  if (!node || typeof node !== "object") return false;
  if (node.type === "ReturnStatement" || node.type === "YieldExpression") return true;
  if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type)) return false;
  return Object.entries(node).some(([key, value]) => {
    if (key === "parent" || !value) return false;
    return Array.isArray(value) ? value.some(armAbruptCompletion) : typeof value === "object" && armAbruptCompletion(value);
  });
}

function catchHasDisposition(state, node) {
  const outcomes = blockOutcomes(state, node.body, false);
  return outcomes === 0
    || (!(outcomes & diverges)
      && retainsPreInitializedFallback(state, node.parent?.type === "TryStatement" ? node.parent.block : null, node.parent));
}

const cleanupReceivers = new Set(["body", "iterator", "reader", "stream"]);
const cleanupReceiverSuffix = /(?:Iterator|Reader|Stream)$/u;

function cleanupReceiverName(node) {
  const receiver = unwrapTransparent(node);
  if (receiver?.type === "Identifier") return receiver.name;
  return staticMemberName(receiver);
}

function isCleanupReceiver(node) {
  const receiver = unwrapTransparent(node);
  if (receiver?.type !== "CallExpression") return false;
  const member = unwrapTransparent(receiver.callee);
  const method = staticMemberName(member);
  if (method !== "cancel" && method !== "return") return false;
  const name = cleanupReceiverName(member.object);
  return Boolean(name) && (cleanupReceivers.has(name) || cleanupReceiverSuffix.test(name));
}

function inlineSuccessBody(node) {
  const call = unwrapTransparent(node);
  if (call?.type !== "CallExpression") return null;
  const member = unwrapTransparent(call.callee);
  if (member?.type !== "MemberExpression" || staticMemberName(member) !== "then") return null;
  const success = unwrapTransparent(call.arguments[0]);
  return success?.type === "ArrowFunctionExpression" || success?.type === "FunctionExpression"
    ? success.body : null;
}

function rejectionCallback(node) {
  const member = unwrapTransparent(node.callee);
  if (member?.type !== "MemberExpression" || isCleanupReceiver(member.object)) return null;
  const method = staticMemberName(member);
  const index = method === "catch" ? 0 : method === "then" ? 1 : -1;
  if (index === -1) return null;
  const callback = unwrapTransparent(node.arguments[index]);
  if (callback?.type !== "ArrowFunctionExpression" && callback?.type !== "FunctionExpression") return null;
  return { callback, protectedRegion: inlineSuccessBody(index === 0 ? member.object : node), statementSpan: node };
}

export const noSilentCatch = {
  meta: {
    type: "problem",
    schema: [{ type: "object", properties: {
      reportingHelpers: { type: "array", items: { type: "string" } },
      reportingModules: { type: "array", items: { type: "string" } },
    }, additionalProperties: false }],
    messages: {
      empty: "Empty catch clauses and rejection handlers are forbidden; return or throw a typed error result, or report the failure.",
      silent: "Caught failures and rejection handlers must be rethrown, returned as a typed error result, or passed to an approved reporting helper.",
    },
  },
  create(context) {
    if (filenameIsInstrumentation(context)) return {};
    const reportingHelpers = new Set(context.options[0]?.reportingHelpers ?? []);
    const reportingModules = new Set(context.options[0]?.reportingModules ?? []);
    const localFunctions = new Map();
    const divergentSubtrees = new WeakSet();
    const catchClauses = [];
    const rejectionCallbacks = [];
    const addLocalFunction = (name, node, body) => {
      const entries = localFunctions.get(name) ?? [];
      entries.push({ node, body });
      localFunctions.set(name, entries);
    };
    const addDivergentLoop = (node) => {
      if (!visiblyDivergentLoop(node)) return;
      let current = node;
      while (current?.parent && !["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(current.type)) {
        divergentSubtrees.add(current);
        current = current.parent;
      }
    };
    return {
      WhileStatement: addDivergentLoop,
      DoWhileStatement: addDivergentLoop,
      ForStatement: addDivergentLoop,
      FunctionDeclaration(node) {
        if (node.id && node.body) addLocalFunction(node.id.name, node, node.body);
      },
      VariableDeclarator(node) {
        if (node.id.type !== "Identifier" || !node.init) return;
        if (node.init.type === "ArrowFunctionExpression" || node.init.type === "FunctionExpression") {
          addLocalFunction(node.id.name, node, node.init.body);
        }
      },
      CatchClause(node) {
        catchClauses.push(node);
      },
      CallExpression(node) {
        const callback = rejectionCallback(node);
        if (callback) rejectionCallbacks.push(callback);
      },
      "Program:exit"() {
        for (const node of catchClauses) {
          const state = {
            sourceCode: context.sourceCode,
            catchClause: node,
            reportingHelpers,
            reportingModules,
            localFunctions,
            divergentSubtrees,
            stack: new Set(),
            memo: new Map(),
            cycleProbe: { hits: 0 },
          };
          if (catchHasDisposition(state, node)) continue;
          context.report({ node, messageId: node.body.body.length === 0 ? "empty" : "silent" });
        }
        for (const { callback: node, protectedRegion, statementSpan } of rejectionCallbacks) {
          if (node.body.type !== "BlockStatement") continue;
          if (node.generator) {
            context.report({ node, messageId: node.body.body.length === 0 ? "empty" : "silent" });
            continue;
          }
          const state = {
            sourceCode: context.sourceCode,
            catchClause: node,
            rejectionCall: statementSpan,
            reportingHelpers,
            reportingModules,
            localFunctions,
            divergentSubtrees,
            stack: new Set(),
            memo: new Map(),
            cycleProbe: { hits: 0 },
          };
          const outcomes = blockOutcomes(state, node.body, false);
          if (outcomes === 0
            || (!(outcomes & diverges) && retainsPreInitializedFallback(state, protectedRegion, statementSpan))) continue;
          context.report({ node, messageId: node.body.body.length === 0 ? "empty" : "silent" });
        }
      },
    };
  },
};
