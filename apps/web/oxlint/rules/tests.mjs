import { allowedMockModules } from "../policy/mock-modules.mjs";

function sourceValue(node) {
  if (node?.type === "Literal" || node?.type === "StringLiteral") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0]?.value.cooked;
  return undefined;
}

function checkSources(context, check) {
  return {
    ImportDeclaration(node) { check(node.source); },
    ExportNamedDeclaration(node) { if (node.source) check(node.source); },
    ExportAllDeclaration(node) { check(node.source); },
    ImportExpression(node) { check(node.source); },
    CallExpression(node) {
      const callee = node.callee;
      if (callee.type === "Identifier" && callee.name === "require") check(node.arguments[0]);
      if (callee.type === "MemberExpression" && !callee.computed
        && callee.object.type === "Identifier" && callee.object.name === "Bun"
        && callee.property.type === "Identifier" && callee.property.name === "file") {
        context.report({ node, messageId: "rejected" });
      }
    },
  };
}

export const noSourceReads = {
  meta: { type: "problem", schema: [], messages: { rejected: "tests must not read source files; assert behavior instead" } },
  create(context) {
    return checkSources(context, (node) => {
      if (["fs", "node:fs", "fs/promises", "node:fs/promises"].includes(sourceValue(node))) {
        context.report({ node, messageId: "rejected" });
      }
    });
  },
};

function memberName(node) {
  if (node?.type !== "MemberExpression") return null;
  if (!node.computed && node.property.type === "Identifier") return node.property.name;
  return sourceValue(node.property);
}

export const noRealWaits = {
  meta: {
    type: "problem", schema: [], messages: {
      delay: "tests must use fake timers instead of real delays over 50ms",
      promiseDelay: "tests must not create delay promises; wait for an observable condition instead",
      sleep: "tests must not sleep; use fake timers or an injected scheduler",
      browserSleep: "Playwright tests must not use waitForTimeout; wait for a locator or poll an observable condition",
      wait: "tests must not wait longer than 2000ms; bound the wait deterministically",
    },
  },
  create(context) {
    function invokesResolver(node, resolverName) {
      if (!node) return false;
      if (node.type === "CallExpression" && node.callee.type === "Identifier"
        && node.callee.name === resolverName) return true;
      if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type)) return false;
      for (const value of Object.values(node)) {
        if (!value || value === node.parent) continue;
        if (Array.isArray(value)) {
          if (value.some((child) => child && typeof child.type === "string"
            && invokesResolver(child, resolverName))) return true;
        } else if (typeof value.type === "string" && invokesResolver(value, resolverName)) return true;
      }
      return false;
    }
    function isPromiseDelay(node) {
      let callback = node.parent;
      while (callback && !["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"].includes(callback.type)) {
        callback = callback.parent;
      }
      if (!callback || callback.type === "FunctionDeclaration"
        || callback.parent?.type !== "NewExpression" || callback.parent.callee.type !== "Identifier"
        || callback.parent.callee.name !== "Promise" || callback.parent.arguments[0] !== callback) return false;
      const resolver = callback.params[0];
      if (resolver?.type !== "Identifier") return false;
      const timerCallback = node.arguments[0];
      return timerCallback?.type === "Identifier" && timerCallback.name === resolver.name
        || timerCallback?.type === "ArrowFunctionExpression" && timerCallback.params.length === 0
        && invokesResolver(timerCallback.body, resolver.name);
    }
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type === "Identifier" && callee.name === "setTimeout" && isPromiseDelay(node)) {
          context.report({ node, messageId: "promiseDelay" });
        } else if (callee.type === "Identifier" && ["setTimeout", "setInterval"].includes(callee.name)) {
          const delay = node.arguments[1];
          if ((delay?.type === "Literal" || delay?.type === "NumericLiteral")
            && typeof delay.value === "number" && delay.value > 50) {
            context.report({ node: delay, messageId: "delay" });
          }
        }
        if (callee.type === "MemberExpression" && ["page", "frame"].includes(
          callee.object.type === "Identifier" ? callee.object.name : "",
        ) && memberName(callee) === "waitForTimeout") {
          context.report({ node, messageId: "browserSleep" });
        }
        if (callee.type === "MemberExpression" && !callee.computed
          && callee.object.type === "Identifier" && callee.object.name === "Bun"
          && memberName(callee) === "sleep") context.report({ node, messageId: "sleep" });
        if (callee.type === "Identifier" && callee.name === "waitFor") {
          const options = node.arguments[1];
          if (options?.type !== "ObjectExpression") return;
          for (const property of options.properties) {
            if (property.type !== "Property" || property.computed || memberName({ type: "MemberExpression", computed: false, property: property.key }) !== "timeout") continue;
            const value = property.value;
            if ((value.type === "Literal" || value.type === "NumericLiteral")
              && typeof value.value === "number" && value.value > 2000) {
              context.report({ node: value, messageId: "wait" });
            }
          }
        }
      },
    };
  },
};

export const noPresentationClassReads = {
  meta: { type: "problem", schema: [], messages: { rejected: "tests must assert behavior, not CSS classes" } },
  create(context) {
    const mutationMethods = new Set(["add", "remove", "toggle", "replace"]);
    function isWrite(node) {
      const parent = node.parent;
      if (parent?.type === "AssignmentExpression" && parent.left === node) return true;
      return parent?.type === "MemberExpression" && parent.object === node
        && mutationMethods.has(memberName(parent))
        && parent.parent?.type === "CallExpression" && parent.parent.callee === parent;
    }
    return {
      MemberExpression(node) {
        const name = memberName(node);
        if ((name === "className" || name === "classList") && !isWrite(node)) {
          context.report({ node, messageId: "rejected" });
        }
      },
      CallExpression(node) {
        if (memberName(node.callee) === "getAttribute" && sourceValue(node.arguments[0]) === "class") {
          context.report({ node, messageId: "rejected" });
        }
      },
    };
  },
};

function unwrapBindingExpression(node) {
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

function resolveVariable(sourceCode, identifier) {
  let scope = sourceCode.getScope(identifier);
  while (scope) {
    const variable = scope.set.get(identifier.name);
    if (variable) return variable;
    scope = scope.upper;
  }
  return null;
}

function importedName(specifier) {
  if (specifier.type !== "ImportSpecifier") return null;
  return specifier.imported.type === "Identifier"
    ? specifier.imported.name
    : specifier.imported.value;
}

function bunTestBindingKind(sourceCode, expression, visited = new Set()) {
  expression = unwrapBindingExpression(expression);
  if (!expression) return null;

  if (expression.type === "MemberExpression") {
    return memberName(expression) === "mock"
      && bunTestBindingKind(sourceCode, expression.object, visited) === "namespace"
      ? "mock"
      : null;
  }
  if (expression.type !== "Identifier") return null;

  const variable = resolveVariable(sourceCode, expression);
  if (!variable || visited.has(variable)
    || variable.references.some((reference) => reference.isWrite() && !reference.init)) return null;
  visited.add(variable);

  for (const definition of variable.defs) {
    if (definition.type === "ImportBinding"
      && definition.parent?.type === "ImportDeclaration"
      && sourceValue(definition.parent.source) === "bun:test"
      && definition.parent.importKind !== "type") {
      if (definition.node.type === "ImportNamespaceSpecifier") return "namespace";
      if (importedName(definition.node) === "mock" && definition.node.importKind !== "type") return "mock";
    }
  }

  const definitions = variable.defs.filter((definition) => definition.type === "Variable");
  if (definitions.length !== 1) return null;
  const declarator = definitions[0].node;
  if (declarator.type !== "VariableDeclarator" || !declarator.init
    || declarator.parent.type !== "VariableDeclaration" || declarator.parent.kind !== "const") return null;

  if (declarator.id.type === "Identifier") {
    return bunTestBindingKind(sourceCode, declarator.init, visited);
  }
  if (declarator.id.type !== "ObjectPattern"
    || bunTestBindingKind(sourceCode, declarator.init, visited) !== "namespace") return null;
  const identifier = variable.identifiers[0];
  const property = declarator.id.properties.find((candidate) =>
    candidate.type === "Property" && !candidate.computed && memberName({
      type: "MemberExpression",
      computed: false,
      property: candidate.key,
    }) === "mock" && candidate.value.type === "Identifier"
    && candidate.value.start === identifier?.start);
  return property ? "mock" : null;
}

function normalizeRelativePath(value) {
  const segments = [];
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.join("/");
}

function appsWebRelativeFilename(context) {
  const filename = String(context.filename ?? "").replaceAll("\\", "/");
  if (!filename) return null;
  const absolute = filename.startsWith("/") || /^[A-Za-z]:\//u.test(filename);
  let relative = filename;

  if (absolute) {
    const cwd = String(context.cwd ?? process.cwd()).replaceAll("\\", "/").replace(/\/$/u, "");
    if (!filename.startsWith(`${cwd}/`)) return null;
    relative = filename.slice(cwd.length + 1);
  }

  relative = relative.replace(/^\.\//u, "").replace(/^apps\/web\//u, "");
  return normalizeRelativePath(relative);
}

export const exactMockModules = {
  meta: {
    type: "problem", schema: [], messages: {
      dynamic: "mock.module requires a static string module name",
      rejected: "mock.module for '{{module}}' is not approved in this test file",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = unwrapBindingExpression(node.callee);
        if (callee?.type !== "MemberExpression" || memberName(callee) !== "module"
          || bunTestBindingKind(context.sourceCode, callee.object) !== "mock") return;
        const moduleName = sourceValue(node.arguments[0]);
        if (typeof moduleName !== "string") {
          context.report({ node: node.arguments[0] ?? node, messageId: "dynamic" });
          return;
        }
        const relativeFilename = appsWebRelativeFilename(context);
        if (!relativeFilename || !allowedMockModules.get(relativeFilename)?.has(moduleName)) {
          context.report({ node: node.arguments[0], messageId: "rejected", data: { module: moduleName } });
        }
      },
    };
  },
};
