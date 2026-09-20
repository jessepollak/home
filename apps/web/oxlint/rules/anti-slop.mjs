// Reducer and evidence-loss helpers in this file are adapted from
// dmmulroy/anti-slop at c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b (MIT).
// See ../THIRD_PARTY_NOTICES.md.

function typeAnnotation(param) {
  if (param?.typeAnnotation?.typeAnnotation) return param.typeAnnotation.typeAnnotation;
  if (param?.type === "AssignmentPattern") return typeAnnotation(param.left);
  if (param?.type === "RestElement") return typeAnnotation(param.argument);
  return null;
}

function unwrapParentheses(node) {
  while (node?.type === "ParenthesizedExpression") node = node.expression;
  return node;
}

function unwrapExpression(node) {
  while (node && [
    "ParenthesizedExpression",
    "ChainExpression",
    "TSAsExpression",
    "TSTypeAssertion",
    "TSNonNullExpression",
    "TSSatisfiesExpression",
  ].includes(node.type)) node = node.expression;
  return node;
}

function memberTarget(node) {
  node = unwrapExpression(node);
  if (node?.type !== "MemberExpression") return null;
  if (!node.computed && node.property.type === "Identifier") {
    return { name: node.property.name, object: node.object };
  }
  if (node.computed && node.property.type === "Literal" && typeof node.property.value === "string") {
    return { name: node.property.value, object: node.object };
  }
  return null;
}

function resolveBinding(sourceCode, node) {
  node = unwrapExpression(node);
  if (node?.type !== "Identifier") return null;
  let scope = sourceCode.getScope(node);
  while (scope) {
    const variable = scope.set.get(node.name);
    if (variable) return variable;
    scope = scope.upper;
  }
  return null;
}

function isGlobalIdentifier(sourceCode, node, name) {
  node = unwrapExpression(node);
  if (node?.type !== "Identifier" || node.name !== name) return false;
  const variable = resolveBinding(sourceCode, node);
  return variable === null || variable.defs.length === 0;
}

function accumulatorVariable(sourceCode, reducer) {
  return sourceCode.getDeclaredVariables(reducer.callback).find((variable) =>
    variable.identifiers.some((identifier) => identifier.start === reducer.accumulator.start));
}

function referencesVariable(sourceCode, node, target, visited = new Set()) {
  const variable = resolveBinding(sourceCode, node);
  if (!variable || visited.has(variable)) return false;
  if (variable === target) return true;
  visited.add(variable);
  if (variable.references.some((reference) => reference.isWrite() && !reference.init)) return false;
  for (const definition of variable.defs) {
    if (definition.type === "Variable" && definition.node.type === "VariableDeclarator"
      && definition.node.id.type === "Identifier" && definition.node.init
      && definition.node.parent.type === "VariableDeclaration"
      && definition.node.parent.kind === "const") {
      return referencesVariable(sourceCode, definition.node.init, target, visited);
    }
  }
  return false;
}

function enclosingReducer(node) {
  let parent = node.parent;
  while (parent) {
    if (parent.type === "FunctionDeclaration") return null;
    if (parent.type === "ArrowFunctionExpression" || parent.type === "FunctionExpression") {
      const callback = parent;
      let owner = callback.parent;
      while (owner && unwrapExpression(owner) === callback) owner = owner.parent;
      if (owner?.type !== "CallExpression") return null;
      const method = memberTarget(owner.callee);
      const firstArgument = owner.arguments[0];
      if (!method || !["reduce", "reduceRight"].includes(method.name)
        || owner.arguments.length > 2 || !firstArgument
        || unwrapExpression(firstArgument) !== callback) return null;
      const firstParameter = callback.params[0];
      const accumulator = firstParameter?.type === "AssignmentPattern"
        ? firstParameter.left
        : firstParameter;
      if (accumulator?.type !== "Identifier") return null;
      return { callback, accumulator, initialValue: owner.arguments[1] };
    }
    parent = parent.parent;
  }
  return null;
}

function isArrayAnnotation(type) {
  if (type.type === "TSArrayType" || type.type === "TSTupleType") return true;
  if (type.type === "TSParenthesizedType") return isArrayAnnotation(type.typeAnnotation);
  if (type.type === "TSTypeOperator" && type.operator === "readonly") {
    return isArrayAnnotation(type.typeAnnotation);
  }
  return type.type === "TSTypeReference" && type.typeName.type === "Identifier"
    && ["Array", "ReadonlyArray"].includes(type.typeName.name);
}

function isKnownArrayExpression(sourceCode, node, visited = new Set()) {
  node = unwrapExpression(node);
  if (node?.type === "ArrayExpression") return true;
  if (node?.type === "CallExpression") {
    const method = memberTarget(node.callee);
    return Boolean(method
      && ["map", "filter", "flatMap", "slice", "concat", "toSorted", "toReversed", "toSpliced"].includes(method.name)
      && isKnownArrayExpression(sourceCode, method.object, visited));
  }
  if (node?.type !== "Identifier") return false;
  const variable = resolveBinding(sourceCode, node);
  if (!variable || visited.has(variable)) return false;
  visited.add(variable);
  if (variable.references.some((reference) => reference.isWrite() && !reference.init)) return false;
  for (const identifier of variable.identifiers) {
    const annotation = identifier.typeAnnotation?.typeAnnotation;
    if (annotation) return isArrayAnnotation(annotation);
  }
  for (const definition of variable.defs) {
    if (definition.type === "Variable" && definition.node.type === "VariableDeclarator"
      && definition.node.id.type === "Identifier" && definition.node.init
      && definition.node.parent.type === "VariableDeclaration"
      && definition.node.parent.kind === "const") {
      return isKnownArrayExpression(sourceCode, definition.node.init, visited);
    }
  }
  return false;
}

function isAssertion(node) {
  return node?.type === "TSAsExpression" || node?.type === "TSTypeAssertion";
}

function isConstAssertion(node) {
  return node.typeAnnotation.type === "TSTypeReference"
    && node.typeAnnotation.typeName.type === "Identifier"
    && node.typeAnnotation.typeName.name === "const";
}

function isOutermostAssertion(node) {
  let current = node;
  let parent = node.parent;
  while (parent?.type === "ParenthesizedExpression" && parent.expression === current) {
    current = parent;
    parent = parent.parent;
  }
  return !isAssertion(parent) || parent.expression !== current;
}

function isForbiddenAssertionChain(node) {
  let count = 0;
  let hasNonConst = false;
  let current = node;
  while (isAssertion(current)) {
    count += 1;
    hasNonConst ||= !isConstAssertion(current);
    current = unwrapParentheses(current.expression);
  }
  return count > 1 && hasNonConst;
}

export const noChainedTypeAssertions = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      rejected: "Do not chain type assertions; keep precise evidence or validate the boundary explicitly.",
    },
  },
  create(context) {
    function check(node) {
      if (isOutermostAssertion(node) && isForbiddenAssertionChain(node)) {
        context.report({ node, messageId: "rejected" });
      }
    }
    return { TSAsExpression: check, TSTypeAssertion: check };
  },
};

export const noReflectIndirection = {
  meta: { type: "problem", schema: [], messages: { rejected: "Use a direct typed operation instead of Reflect.{{name}}." } },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type === "MemberExpression" && !callee.computed
          && callee.object.type === "Identifier" && callee.object.name === "Reflect"
          && callee.property.type === "Identifier" && ["get", "apply"].includes(callee.property.name)) {
          context.report({ node, messageId: "rejected", data: { name: callee.property.name } });
        }
      },
    };
  },
};

export const noVagueObjectParameters = {
  meta: { type: "problem", schema: [], messages: { rejected: "Give object parameters a specific structural type." } },
  create(context) {
    function check(node) {
      for (const param of node.params ?? []) {
        if (typeAnnotation(param)?.type === "TSObjectKeyword") context.report({ node: param, messageId: "rejected" });
      }
    }
    return {
      FunctionDeclaration: check,
      FunctionExpression: check,
      ArrowFunctionExpression: check,
      TSDeclareFunction: check,
    };
  },
};

export const noUnknownAliases = {
  meta: { type: "problem", schema: [], messages: { rejected: "A type alias must add meaning; do not alias unknown directly." } },
  create(context) {
    return {
      TSTypeAliasDeclaration(node) {
        if (node.typeAnnotation.type === "TSUnknownKeyword") context.report({ node, messageId: "rejected" });
      },
    };
  },
};

const reducerMessage = "Do not copy the reducer accumulator on every iteration. Build a fresh local accumulator and update it in one pass; do not blindly mutate an externally owned initial value.";

export const noReducerAccumulatorSpread = {
  meta: { type: "problem", schema: [], messages: { rejected: reducerMessage } },
  create(context) {
    return {
      SpreadElement(node) {
        if (node.parent?.type !== "ObjectExpression" && node.parent?.type !== "ArrayExpression") return;
        const reducer = enclosingReducer(node);
        if (!reducer) return;
        const accumulator = accumulatorVariable(context.sourceCode, reducer);
        if (accumulator && referencesVariable(context.sourceCode, node.argument, accumulator)) {
          context.report({ node, messageId: "rejected" });
        }
      },
    };
  },
};

export const noReduceAccumulatorCopy = {
  meta: { type: "problem", schema: [], messages: { rejected: reducerMessage } },
  create(context) {
    return {
      CallExpression(node) {
        const method = memberTarget(node.callee);
        if (!method) return;
        const reducer = enclosingReducer(node);
        if (!reducer) return;
        const accumulator = accumulatorVariable(context.sourceCode, reducer);
        if (!accumulator) return;
        const isAccumulator = (expression) =>
          referencesVariable(context.sourceCode, expression, accumulator);
        let copies = false;
        if (method.name === "assign" && isGlobalIdentifier(context.sourceCode, method.object, "Object")) {
          const target = unwrapExpression(node.arguments[0]);
          copies = target?.type === "ObjectExpression" && target.properties.length === 0
            && node.arguments.slice(1).some(isAccumulator);
        } else if (method.name === "from" && isGlobalIdentifier(context.sourceCode, method.object, "Array")) {
          copies = Boolean(node.arguments[0] && isAccumulator(node.arguments[0]));
        } else if (["concat", "slice", "toSpliced", "toSorted", "toReversed", "with"].includes(method.name)) {
          copies = Boolean(reducer.initialValue
            && isKnownArrayExpression(context.sourceCode, reducer.initialValue)
            && isAccumulator(method.object));
        }
        if (copies) context.report({ node, messageId: "rejected" });
      },
    };
  },
};

const functionBoundaryTypes = new Set([
  "ArrowFunctionExpression",
  "FunctionDeclaration",
  "FunctionExpression",
  "TSDeclareFunction",
  "TSEmptyBodyFunctionExpression",
]);

function unwrapType(type) {
  while (type.type === "TSParenthesizedType") type = type.typeAnnotation;
  return type;
}

function typeReferenceName(type) {
  return type.typeName.type === "Identifier" ? type.typeName.name : null;
}

function isUnknownOrAnyType(type) {
  type = unwrapType(type);
  return type.type === "TSUnknownKeyword" || type.type === "TSAnyKeyword";
}

function isBroadRecordKey(type) {
  type = unwrapType(type);
  if (["TSStringKeyword", "TSNumberKeyword", "TSSymbolKeyword"].includes(type.type)) return true;
  if (type.type === "TSUnionType") return type.types.every(isBroadRecordKey);
  return type.type === "TSTypeReference" && typeReferenceName(type) === "PropertyKey";
}

function isBroadRecord(type) {
  type = unwrapType(type);
  if (type.type === "TSTypeReference") {
    if (typeReferenceName(type) === "Readonly") {
      const [inner] = type.typeArguments?.params ?? [];
      return Boolean(inner && isBroadRecord(inner));
    }
    if (typeReferenceName(type) !== "Record") return false;
    const parameters = type.typeArguments?.params ?? [];
    return parameters.length === 2 && isBroadRecordKey(parameters[0])
      && isUnknownOrAnyType(parameters[1]);
  }
  if (type.type !== "TSTypeLiteral" || type.members.length !== 1) return false;
  const [member] = type.members;
  const [parameter] = member?.type === "TSIndexSignature" ? member.parameters : [];
  return member?.type === "TSIndexSignature" && member.parameters.length === 1
    && Boolean(parameter?.typeAnnotation?.typeAnnotation)
    && isBroadRecordKey(parameter.typeAnnotation.typeAnnotation)
    && isUnknownOrAnyType(member.typeAnnotation.typeAnnotation);
}

function broadTypeKind(type) {
  type = unwrapType(type);
  if (type.type === "TSUnknownKeyword" || type.type === "TSAnyKeyword") return "top";
  if (type.type === "TSObjectKeyword") return "object";
  return isBroadRecord(type) ? "record" : null;
}

function normalizedTypeText(sourceText, type) {
  type = unwrapType(type);
  return sourceText.slice(type.start, type.end).replaceAll(/\s+/gu, "");
}

function typesHaveSameSyntax(sourceText, left, right) {
  return Boolean(left && normalizedTypeText(sourceText, left) === normalizedTypeText(sourceText, right));
}

function isEmptyObjectWidth(type) {
  type = unwrapType(type);
  return (type.type === "TSTypeLiteral" && type.members.length === 0)
    || (type.type === "TSTypeReference" && typeReferenceName(type) === "Object");
}

function isNarrowerRecord(type) {
  type = unwrapType(type);
  if (type.type === "TSTypeLiteral") {
    return type.members.some((member) => member.type !== "TSIndexSignature");
  }
  if (type.type !== "TSTypeReference") return false;
  if (typeReferenceName(type) === "Readonly") {
    const [inner] = type.typeArguments?.params ?? [];
    return Boolean(inner && isNarrowerRecord(inner));
  }
  if (typeReferenceName(type) !== "Record") return false;
  const parameters = type.typeArguments?.params ?? [];
  return parameters.length === 2
    && (!isBroadRecordKey(parameters[0]) || !isUnknownOrAnyType(parameters[1]));
}

function functionBoundary(node) {
  let current = node.parent;
  while (current && current.type !== "Program") {
    if (functionBoundaryTypes.has(current.type)) return current;
    current = current.parent;
  }
  return null;
}

function resolvedVariable(scopes, identifier) {
  for (const scope of scopes) {
    const reference = scope.references.find((candidate) =>
      candidate.identifier.start === identifier.start && candidate.identifier.end === identifier.end);
    if (reference) return reference.resolved;
  }
  return null;
}

function variableDeclarator(variable) {
  for (const definition of variable.defs) {
    if (definition.type === "Variable" && definition.node.type === "VariableDeclarator") {
      return definition.node;
    }
  }
  return null;
}

function knownValueEvidence(expression, scopes, boundary, visited) {
  const unwrapped = unwrapParentheses(expression);
  if (isAssertion(unwrapped)) {
    if (broadTypeKind(unwrapped.typeAnnotation)) return null;
    return { type: unwrapped.typeAnnotation };
  }
  if (unwrapped.type === "Literal" || unwrapped.type === "TemplateLiteral"
    || ["ArrayExpression", "ArrowFunctionExpression", "ClassExpression", "FunctionExpression", "NewExpression", "ObjectExpression"].includes(unwrapped.type)) {
    return { type: null };
  }
  if (unwrapped.type !== "Identifier") return null;
  const variable = resolvedVariable(scopes, unwrapped);
  if (!variable || visited.has(variable)) return null;
  const annotated = variable.identifiers.find((identifier) => identifier.typeAnnotation?.typeAnnotation);
  const annotation = annotated?.typeAnnotation?.typeAnnotation;
  const declarator = variableDeclarator(variable);
  if (annotation) {
    if (!declarator || declarator.parent.type !== "VariableDeclaration"
      || declarator.parent.kind !== "const"
      || variable.references.some((reference) => reference.isWrite() && !reference.init)
      || functionBoundary(annotated) !== boundary || broadTypeKind(annotation)) return null;
    return { type: annotation };
  }
  if (!declarator || declarator.parent.type !== "VariableDeclaration"
    || declarator.parent.kind !== "const" || !declarator.init
    || variable.references.some((reference) => reference.isWrite() && !reference.init)
    || functionBoundary(declarator) !== boundary) return null;
  return knownValueEvidence(declarator.init, scopes, boundary, new Set([...visited, variable]));
}

function widenedBinding(variable, scopes) {
  const declarator = variableDeclarator(variable);
  if (!declarator || declarator.parent.type !== "VariableDeclaration"
    || declarator.parent.kind !== "const" || declarator.id.type !== "Identifier" || !declarator.init
    || variable.references.some((reference) => reference.isWrite() && !reference.init)) return null;
  const boundary = functionBoundary(declarator);
  const declaredType = declarator.id.typeAnnotation?.typeAnnotation;
  const initializer = unwrapParentheses(declarator.init);
  const initializerAssertion = isAssertion(initializer) ? initializer : null;
  const initializerBroadKind = initializerAssertion ? broadTypeKind(initializerAssertion.typeAnnotation) : null;
  const broadKind = (declaredType ? broadTypeKind(declaredType) : null) ?? initializerBroadKind;
  if (!broadKind) return null;
  const original = initializerAssertion && initializerBroadKind
    ? unwrapParentheses(initializerAssertion.expression)
    : declarator.init;
  const evidence = knownValueEvidence(original, scopes, boundary, new Set([variable]));
  return evidence ? { broadKind, evidence, declaredAt: declarator.end, boundary } : null;
}

function assertionIsNarrower(sourceText, widened, assertedType) {
  if (broadTypeKind(assertedType)) return false;
  if (typesHaveSameSyntax(sourceText, widened.evidence.type, assertedType)) return true;
  if (widened.broadKind === "top") return true;
  if (widened.broadKind === "object") return !isEmptyObjectWidth(assertedType);
  return isNarrowerRecord(assertedType);
}

export const noWidenThenAssert = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      rejected: "Binding '{{name}}' discards type evidence and later recreates it with an assertion. Keep the precise type through use, or parse boundary input once.",
    },
  },
  create(context) {
    let scopes = [];
    function check(node) {
      const expression = unwrapParentheses(node.expression);
      if (expression.type !== "Identifier") return;
      const variable = resolvedVariable(scopes, expression);
      if (!variable) return;
      const widened = widenedBinding(variable, scopes);
      if (!widened || node.start <= widened.declaredAt
        || functionBoundary(node) !== widened.boundary
        || !assertionIsNarrower(context.sourceCode.text, widened, node.typeAnnotation)) return;
      context.report({ node, messageId: "rejected", data: { name: expression.name } });
    }
    return {
      Program() { scopes = context.sourceCode.scopeManager.scopes; },
      TSAsExpression: check,
      TSTypeAssertion: check,
    };
  },
};
