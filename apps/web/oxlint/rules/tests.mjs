import { allowedMockModules } from "../policy/mock-modules.mjs";

const testFileSuffix = /\.(?:test|pw)\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/u;
const moduleSuffix = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/u;
const expectationMatchers = new Set([
  "toBe",
  "toEqual",
  "toStrictEqual",
  "toContain",
  "toContainEqual",
  "toMatch",
  "toMatchObject",
  "toHaveLength",
  "toBeLessThan",
  "toBeGreaterThan",
]);

function normalizedStem(name) {
  return name.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-").replaceAll(/^-|-$/gu, "");
}

function resolvedImportPath(testRelativePath, source) {
  const segments = source.startsWith("@/")
    ? source.slice(2).split("/")
    : [...testRelativePath.split("/").slice(0, -1), ...source.split("/")];
  const resolved = normalizeRelativePath(segments.join("/"));
  if (resolved === null) return null;
  return source === "." ? [resolved, "index"].filter(Boolean).join("/") : resolved;
}

function directoryName(modulePath) {
  return modulePath.split("/").slice(0, -1).join("/");
}

function expectedArgument(node) {
  let current = node.callee;
  const members = [];
  while (current?.type === "MemberExpression" && !current.computed
    && current.property.type === "Identifier") {
    members.push(current.property.name);
    current = current.object;
  }
  if (current?.type !== "CallExpression" || current.callee.type !== "Identifier"
    || current.callee.name !== "expect") return null;
  if (!members.some((name) => expectationMatchers.has(name))) return null;
  return node.arguments[0] ?? null;
}

const transparentExpectedValue = new Set([
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
]);

function containsSubjectBinding(node, subjectBindings, subjectNamespaces) {
  if (!node) return false;
  if (node.type === "Identifier") return subjectBindings.has(node.name);
  if (transparentExpectedValue.has(node.type)) {
    return containsSubjectBinding(node.expression, subjectBindings, subjectNamespaces);
  }
  if (node.type === "ArrayExpression") {
    return node.elements.some((element) => element && containsSubjectBinding(
      element.type === "SpreadElement" ? element.argument : element,
      subjectBindings,
      subjectNamespaces,
    ));
  }
  if (node.type === "ObjectExpression") {
    return node.properties.some((property) => containsSubjectBinding(
      property.type === "SpreadElement" ? property.argument : property.value,
      subjectBindings,
      subjectNamespaces,
    ));
  }
  if (node.type === "TemplateLiteral") {
    return node.expressions.some((expression) =>
      containsSubjectBinding(expression, subjectBindings, subjectNamespaces));
  }
  if (node.type !== "MemberExpression" || node.object.type !== "Identifier"
    || !subjectNamespaces.has(node.object.name)) return false;
  return !node.computed || node.property.type === "Literal";
}

export const noSelfReferentialExpectation = {
  meta: {
    type: "problem", schema: [], messages: {
      rejected: "Expectations must assert an independently derived value, not an identifier imported from the module under test.",
    },
  },
  create(context) {
    const relative = appsWebRelativeFilename(context);
    if (!relative) return {};
    const subjectPath = relative.replace(testFileSuffix, "");
    if (subjectPath === relative) return {};
    const stem = normalizedStem(subjectPath.split("/").pop() ?? "");
    const subjectBindings = new Set();
    const subjectNamespaces = new Set();
    return {
      ImportDeclaration(node) {
        const source = sourceValue(node.source);
        if (typeof source !== "string"
          || !(source === "." || source.startsWith("./") || source.startsWith("../") || source.startsWith("@/"))) return;
        const resolved = resolvedImportPath(relative, source);
        if (resolved === null) return;
        const resolvedModule = resolved.replace(moduleSuffix, "");
        const importStem = normalizedStem(resolvedModule.split("/").pop() ?? "");
        const matchingSameDirectoryStem = directoryName(resolvedModule) === directoryName(subjectPath)
          && importStem === stem;
        if (resolvedModule !== subjectPath && !matchingSameDirectoryStem) return;
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportNamespaceSpecifier") subjectNamespaces.add(specifier.local.name);
          else subjectBindings.add(specifier.local.name);
        }
      },
      CallExpression(node) {
        const expected = expectedArgument(node);
        if (!containsSubjectBinding(expected, subjectBindings, subjectNamespaces)) return;
        context.report({ node: expected, messageId: "rejected" });
      },
    };
  },
};

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

export const noRequestOnlyPlaywright = {
  meta: {
    type: "problem", schema: [], messages: {
      rejected: "Playwright tests must exercise a browser; move request-only checks to a route or unit test.",
    },
  },
  create(context) {
    if (!/\.pw\.(?:ts|tsx)$/u.test(String(context.filename ?? ""))) return {};
    const testModifiers = new Set(["only", "skip", "fixme", "fail", "slow"]);
    const browserFixtures = new Set(["page", "context", "browser"]);
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (!(callee.type === "Identifier" && callee.name === "test")
          && !(callee.type === "MemberExpression" && !callee.computed
            && callee.object.type === "Identifier" && callee.object.name === "test"
            && callee.property.type === "Identifier" && testModifiers.has(callee.property.name))) return;
        const callback = [...node.arguments].reverse().find((argument) =>
          argument.type === "ArrowFunctionExpression" || argument.type === "FunctionExpression");
        const firstParam = callback?.params[0];
        const pattern = firstParam?.type === "AssignmentPattern" ? firstParam.left : firstParam;
        if (pattern?.type !== "ObjectPattern") return;
        const keys = new Set(pattern.properties.filter((property) => property.type === "Property" && !property.computed)
          .map((property) => property.key.type === "Identifier" ? property.key.name : sourceValue(property.key)));
        if (keys.has("request") && ![...browserFixtures].some((fixture) => keys.has(fixture))) {
          context.report({ node: pattern, messageId: "rejected" });
        }
      },
    };
  },
};

const clockGlobals = new Set(["globalThis", "window", "self", "global"]);
const pageCallbackMethods = new Set(["evaluate", "evaluateHandle", "addInitScript", "waitForFunction"]);
const testClockModules = new Set(["@jest/globals", "bun:test", "vitest"]);
const clockFrameworkModules = new Set([...testClockModules, "@playwright/test"]);
const testClockNamespaces = new Set(["jest", "vi"]);
const playwrightClockReceivers = new Set(["context", "page"]);
const clockTestNames = new Set(["test", "it"]);
const clockHookNames = new Set(["beforeEach", "beforeAll", "afterEach", "afterAll", "before", "after"]);
const clockPreHookNames = new Set(["beforeEach", "beforeAll", "before"]);
const clockTestModifiers = new Set(["only", "skip", "todo", "fixme", "fail", "slow", "concurrent", "sequential", "each",
  "skipIf", "runIf", "if", "todoIf", "failIf", "fails", "failsIf", "for"]);
const clockContainerModifiers = new Set(["only", "skip", "each", "serial", "parallel",
  "concurrent", "sequential", "shuffle", "todo", "runIf", "skipIf"]);

function clockContextName(node, sourceCode) {
  return node?.type === "Identifier" ? clockImport(sourceCode, node, clockFrameworkModules) ?? node.name
    : node?.type === "MemberExpression" && !node.computed
    && node.property.type === "Identifier" ? node.property.name : null;
}

function clockContextKind(callee, sourceCode) {
  callee = unwrapBindingExpression(callee);
  if (callee?.type === "CallExpression") return clockContextKind(callee.callee, sourceCode);
  if (callee?.type === "TaggedTemplateExpression") return clockContextKind(callee.tag, sourceCode);
  const name = clockContextName(callee, sourceCode);
  if (clockTestNames.has(name)) return { kind: "test", name };
  if (clockHookNames.has(name)) return { kind: "hook", name };
  if (name === "describe") return { kind: "container", name };
  if (callee?.type !== "MemberExpression"
    || !clockTestModifiers.has(name) && !clockContainerModifiers.has(name)) return null;
  for (let owner = unwrapBindingExpression(callee.object); owner;) {
    const ownerName = clockContextName(owner, sourceCode);
    if (ownerName === "describe" && clockContainerModifiers.has(name)) {
      return { kind: "container", name: ownerName };
    }
    if (clockTestNames.has(ownerName) && clockTestModifiers.has(name)) return { kind: "test", name: ownerName };
    owner = unwrapBindingExpression(owner.type === "CallExpression" ? owner.callee
      : owner.type === "MemberExpression" && !owner.computed ? owner.object : null);
  }
  return null;
}

function declaredClockBinding(sourceCode, declaration, identifier) {
  return sourceCode.getDeclaredVariables(declaration).find((variable) =>
    variable.name === identifier.name && variable.defs.some((definition) => definition.node === declaration));
}

function clockFunction(node, sourceCode) {
  node = unwrapBindingExpression(node);
  if (["ArrowFunctionExpression", "FunctionExpression"].includes(node?.type)) return { callback: node, binding: null };
  if (node?.type !== "Identifier") return null;
  const variable = resolveVariable(sourceCode, node);
  const definition = variable?.defs[0];
  const declaration = definition?.node;
  const callback = definition?.type === "FunctionName" && declaration.type === "FunctionDeclaration" ? declaration
    : definition?.type === "Variable" && declaration.id.type === "Identifier" && declaration.parent.kind === "const"
    ? unwrapBindingExpression(declaration.init) : null;
  if (!["FunctionDeclaration", "ArrowFunctionExpression", "FunctionExpression"].includes(callback?.type)) return null;
  const binding = declaredClockBinding(sourceCode, declaration, declaration.id);
  return binding === variable ? { callback, binding } : null;
}

function clockScope(node, sourceCode, callbackCalls, containerOnly = false) {
  const visited = new Set();
  for (let current = node.parent; current; current = current.parent) {
    if (visited.has(current)) return { kind: "function", node: current };
    visited.add(current);
    if (current.type === "Program") return { kind: "program", node: current };
    if (!callbackCalls.has(current)) continue;
    const call = callbackCalls.get(current);
    if (!call) return { kind: "function", node: current };
    const contextKind = clockContextKind(call.callee, sourceCode);
    if (!containerOnly || contextKind.kind === "container") return { ...contextKind, node: call };
    current = call;
  }
  return { kind: "program", node: null };
}

function clockContainers(node, sourceCode, callbackCalls) {
  const containers = [];
  const visited = new Set([node]);
  for (;;) {
    const container = clockScope(node, sourceCode, callbackCalls, true);
    if (visited.has(container.node)) break;
    visited.add(container.node);
    containers.push(container.node);
    if (container.kind !== "container") break;
    node = container.node;
  }
  return containers;
}

function clockBinding(node, sourceCode, visited = new Set()) {
  node = unwrapBindingExpression(node);
  if (node?.type === "MemberExpression") {
    const owner = clockBinding(node.object, sourceCode, visited);
    const property = memberName(node);
    if (owner === "global" && ["Date", "performance"].includes(property)) return property;
    if (property === "now" && owner === "Date") return "date";
    if (property === "now" && owner === "performance") return "performanceNow";
    return null;
  }
  if (node?.type !== "Identifier") return null;
  const variable = resolveVariable(sourceCode, node);
  if (!variable?.defs.length) {
    return clockGlobals.has(node.name) ? "global" : ["Date", "performance"].includes(node.name) ? node.name : null;
  }
  if (visited.has(variable) || variable.references.some((reference) => reference.isWrite() && !reference.init)) return null;
  visited.add(variable);
  const definition = variable.defs[0];
  const declarator = definition?.node;
  if (definition?.type !== "Variable" || declarator.parent.kind !== "const") return null;
  if (declarator.id.type === "Identifier") return clockBinding(declarator.init, sourceCode, visited);
  if (declarator.id.type !== "ObjectPattern") return null;
  const property = declarator.id.properties.find((candidate) => {
    if (candidate.type !== "Property") return false;
    const binding = candidate.value.type === "AssignmentPattern" ? candidate.value.left : candidate.value;
    return binding.type === "Identifier" && binding.start === variable.identifiers[0]?.start;
  });
  return property ? clockBinding({ type: "MemberExpression", object: declarator.init,
    computed: property.computed, property: property.key }, sourceCode, visited) : null;
}

function clockObject(node, name, sourceCode) {
  return clockBinding(node, sourceCode) === name;
}

function clockProperty(node, sourceCode) {
  const binding = clockBinding(node, sourceCode);
  return binding === "date" ? "date" : binding === "performanceNow" ? "performance" : null;
}

function clockImport(sourceCode, identifier, modules = testClockModules) {
  const variable = resolveVariable(sourceCode, identifier);
  if (!variable || variable.references.some((reference) => reference.isWrite() && !reference.init)) return null;
  for (const definition of variable.defs) {
    if (definition.type !== "ImportBinding" || definition.parent?.type !== "ImportDeclaration") continue;
    if (definition.parent.importKind === "type" || definition.node.importKind === "type") continue;
    if (!modules.has(sourceValue(definition.parent.source))) continue;
    return definition.node.type === "ImportNamespaceSpecifier" ? "namespace" : importedName(definition.node);
  }
  return null;
}

function clockNamespace(sourceCode, callee) {
  if (callee?.type !== "MemberExpression") return false;
  const owner = unwrapBindingExpression(callee.object);
  if (owner?.type !== "Identifier") return false;
  const imported = clockImport(sourceCode, owner);
  return imported === "namespace" || testClockNamespaces.has(imported);
}

function unpinningInstant(node) {
  node = unwrapBindingExpression(node);
  if (node?.type === "UnaryExpression" && node.operator === "void") return true;
  return node?.type === "Identifier" && node.name === "undefined";
}

function playwrightClockCall(callee) {
  if (callee?.type !== "MemberExpression") return false;
  const receiver = unwrapBindingExpression(callee.object);
  if (receiver?.type !== "MemberExpression" || memberName(receiver) !== "clock") return false;
  const owner = unwrapBindingExpression(receiver.object);
  return owner?.type === "Identifier" && playwrightClockReceivers.has(owner.name);
}

function clockOptionValue(node, key) {
  if (node?.type !== "ObjectExpression") return null;
  for (const property of [...node.properties].reverse()) {
    if (property.type !== "Property") return null;
    const name = memberName({ type: "MemberExpression", computed: property.computed, property: property.key });
    if (name === key) return property.kind === "init" && !property.method ? property.value : null;
    if (name == null) return null;
  }
  return null;
}

function outerClockExpression(node) {
  while (node.parent && ["ChainExpression", "ParenthesizedExpression",
    "TSAsExpression", "TSNonNullExpression", "TSSatisfiesExpression", "TSTypeAssertion"].includes(node.parent.type)) {
    node = node.parent;
  }
  return node;
}

function pageClockCallback(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (!["ArrowFunctionExpression", "FunctionExpression"].includes(current.type)) continue;
    const call = current.parent;
    if (call?.type === "CallExpression" && call.arguments.includes(current)
      && pageCallbackMethods.has(memberName(call.callee))) return true;
  }
  return false;
}

function performanceCall(node, sourceCode) {
  node = unwrapBindingExpression(node);
  return node?.type === "CallExpression" && clockProperty(node.callee, sourceCode) === "performance";
}

export const noRealWaits = {
  meta: {
    type: "problem", schema: [], messages: {
      delay: "tests must use fake timers instead of real delays over 50ms",
      promiseDelay: "tests must not create delay promises; wait for an observable condition instead",
      sleep: "tests must not sleep; use fake timers or an injected scheduler",
      browserSleep: "Playwright tests must not use waitForTimeout; wait for a locator or poll an observable condition",
      wallClock: "tests must not read the wall clock; inject a clock or pin a fixed time",
      wait: "tests must not wait longer than 2000ms with an inline timeout; a named guard object is a deliberate hang budget",
    },
  },
  create(context) {
    const playwright = /\.pw\.(?:ts|tsx)$/u.test(String(context.filename ?? ""));
    const clockReads = [];
    const pinCandidates = [];
    const subtractions = [];
    const callbackCalls = new Map();
    const callbackBindings = new Map();
    function pinnedPageClock(node, pageClockPinned) {
      return playwright && pageClockPinned && pageClockCallback(node);
    }
    function withinArgument(node, argument) {
      for (let current = node; current; current = current.parent) {
        if (current === argument) return true;
      }
      return false;
    }
    function pinSources(argument) {
      const sources = [argument];
      const pending = [argument];
      while (pending.length > 0) {
        const node = pending.pop();
        if (!node || typeof node.type !== "string") continue;
        if (node.type === "Identifier") {
          const init = resolveVariable(context.sourceCode, node)?.defs[0]?.node?.init;
          if (init && !sources.includes(init)) {
            sources.push(init);
            pending.push(init);
          }
          continue;
        }
        for (const [key, value] of Object.entries(node)) {
          if (key === "parent" || !value) continue;
          if (key === "key" && node.type === "Property" && !node.computed) continue;
          if (key === "property" && node.type === "MemberExpression" && !node.computed) continue;
          if (Array.isArray(value)) pending.push(...value);
          else if (typeof value.type === "string") pending.push(value);
        }
      }
      return sources;
    }
    function measuredPerformance(call) {
      const outer = outerClockExpression(call);
      if (outer.parent?.type === "BinaryExpression" && outer.parent.operator === "-") return true;
      if (outer.parent?.type !== "VariableDeclarator" || outer.parent.init !== outer
        || outer.parent.id.type !== "Identifier"
        || outer.parent.parent?.type !== "VariableDeclaration"
        || outer.parent.parent.kind !== "const") return false;
      const binding = resolveVariable(context.sourceCode, outer.parent.id);
      return subtractions.some((minus) => {
        const left = unwrapBindingExpression(minus.left);
        const right = unwrapBindingExpression(minus.right);
        const other = performanceCall(left, context.sourceCode) ? right
          : performanceCall(right, context.sourceCode) ? left : null;
        return other?.type === "Identifier" && other.name === outer.parent.id.name
          && resolveVariable(context.sourceCode, other) === binding;
      });
    }
    function pinnedBy(node) {
      if (node.arguments.length === 0) return;
      const callee = unwrapBindingExpression(node.callee);
      const method = memberName(callee);
      const argument = node.arguments[0];
      const record = (instant) => {
        if (!unpinningInstant(instant)) pinCandidates.push({ argument, node });
      };
      const recordFakeTimers = () => {
        const now = clockOptionValue(argument, "now");
        if (now) record(now);
      };
      if (playwright) {
        if (!playwrightClockCall(callee)) return;
        if (method === "install") {
          const time = clockOptionValue(argument, "time");
          if (time) record(time);
        } else if (method === "setFixedTime" || method === "setSystemTime") record(argument);
        return;
      }
      if (callee?.type === "MemberExpression") {
        if (!clockNamespace(context.sourceCode, callee)) return;
        if (method === "setSystemTime") record(argument);
        else if (method === "useFakeTimers") recordFakeTimers();
        return;
      }
      if (callee?.type !== "Identifier") return;
      const imported = clockImport(context.sourceCode, callee);
      if (imported === "setSystemTime") record(argument);
      else if (imported === "useFakeTimers") recordFakeTimers();
    }
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
      BinaryExpression(node) {
        if (node.operator === "-") subtractions.push(node);
      },
      Identifier(node) {
        if (node.parent?.type === "Property" && node.parent.key === node && !node.parent.computed) return;
        if (!resolveVariable(context.sourceCode, node)?.references.some((reference) =>
          reference.isRead() && reference.identifier.start === node.start)) return;
        const kind = clockProperty(node, context.sourceCode);
        if (!kind) return;
        const outer = outerClockExpression(node);
        const call = outer.parent?.type === "CallExpression" && outer.parent.callee === outer
          ? outer.parent : null;
        clockReads.push({ kind, node: call ?? node, call });
      },
      MemberExpression(node) {
        const kind = clockProperty(node, context.sourceCode);
        if (!kind) return;
        const outer = outerClockExpression(node);
        const call = outer.parent?.type === "CallExpression" && outer.parent.callee === outer
          ? outer.parent : null;
        clockReads.push({ kind, node: call ?? node, call });
      },
      NewExpression(node) {
        if (clockObject(node.callee, "Date", context.sourceCode) && node.arguments.length === 0) {
          clockReads.push({ kind: "date", node });
        }
      },
      "Program:exit"() {
        for (const [callback, { binding, argument }] of callbackBindings) {
          const references = binding?.references.filter((reference) => !reference.init);
          const selfBinding = callback.type === "FunctionExpression" && callback.id
            ? declaredClockBinding(context.sourceCode, callback, callback.id) : null;
          if (binding && (references.length !== 1 || references[0].identifier.start !== argument.start)
            || selfBinding?.references.some((reference) => !reference.init)) callbackCalls.set(callback, null);
        }
        const pins = pinCandidates.map(({ argument, node }) => {
          const scope = clockScope(node, context.sourceCode, callbackCalls);
          return {
            sources: pinSources(argument), scope, start: node.start,
            container: scope.kind === "hook"
              ? clockScope(scope.node, context.sourceCode, callbackCalls, true).node : null,
          };
        });
        const withinPin = (read, sources) => sources.some((source) => withinArgument(read.node, source));
        const preHook = (pin) => pin.scope.kind === "hook" && clockPreHookNames.has(pin.scope.name);
        const scopeLast = new Map();
        const containerHooks = new Map();
        for (const pin of pins.filter(preHook)) {
          const entry = containerHooks.get(pin.container) ?? { early: [], each: [] };
          entry[pin.scope.name === "beforeEach" ? "each" : "early"].push(pin);
          containerHooks.set(pin.container, entry);
        }
        const lastRegistered = (list) => list.reduce((latest, pin) =>
          !latest || pin.scope.node.start > latest.scope.node.start
            || (pin.scope.node.start === latest.scope.node.start && pin.start > latest.start) ? pin : latest, null);
        const governingHook = (scope, containers) => {
          if (!["test", "hook"].includes(scope.kind)) return null;
          const earlyOnly = scope.kind === "hook" && ["beforeAll", "before"].includes(scope.name);
          for (const phase of earlyOnly ? ["early"] : ["each", "early"]) {
            for (const container of containers) {
              const list = containerHooks.get(container)?.[phase];
              if (list?.length) return lastRegistered(list);
            }
          }
          return null;
        };
        for (const pin of [...pins].sort((a, b) => a.start - b.start)) {
          scopeLast.set(pin.scope.node, pin);
        }
        const invalidPin = (pin) => clockReads.some((read) => withinPin(read, pin.sources));
        for (const read of clockReads) {
          const pinArgumentRead = pins.some(({ sources }) => withinPin(read, sources));
          const scope = clockScope(read.node, context.sourceCode, callbackCalls);
          const containers = clockContainers(scope.node, context.sourceCode, callbackCalls);
          const deciding = scopeLast.get(scope.node) ?? governingHook(scope, containers);
          const governed = deciding ? !invalidPin(deciding) : false;
          if (!pinArgumentRead && read.kind === "date"
            && (playwright ? pinnedPageClock(read.node, governed) : governed)) continue;
          if (!pinArgumentRead && read.kind === "performance" && read.call
            && measuredPerformance(read.call)) continue;
          context.report({ node: read.node, messageId: "wallClock" });
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (clockContextKind(callee, context.sourceCode)) {
          const registration = [...node.arguments].reverse().map((argument) => {
            const resolved = clockFunction(argument, context.sourceCode);
            return resolved ? { ...resolved, argument: unwrapBindingExpression(argument) } : null;
          }).find(Boolean);
          if (registration) {
            callbackCalls.set(registration.callback, node);
            callbackBindings.set(registration.callback, registration);
          }
        }
        pinnedBy(node);
        if (clockObject(callee, "Date", context.sourceCode)) clockReads.push({ kind: "date", node });
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

function scalarLiteralValue(node) {
  if (!node) return undefined;
  if (["Literal", "NumericLiteral", "StringLiteral", "BooleanLiteral", "BigIntLiteral"].includes(node.type)) {
    return node.regex || node.value === null ? undefined : node.value;
  }
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return sourceValue(node);
  if (node.type === "UnaryExpression" && ["-", "+"].includes(node.operator)) {
    const argument = node.argument;
    if (["Literal", "NumericLiteral"].includes(argument.type) && typeof argument.value === "number") {
      return node.operator === "-" ? -argument.value : argument.value;
    }
    if (["Literal", "BigIntLiteral"].includes(argument.type)
      && (typeof argument.value === "bigint" || argument.bigint !== undefined || argument.type === "BigIntLiteral")) {
      const literal = typeof argument.value === "bigint" ? argument.value : argument.bigint ?? argument.value;
      if (typeof literal === "bigint") return node.operator === "-" ? -literal : literal;
      if (typeof literal !== "string") return undefined;
      const value = BigInt(literal.replace(/n$/u, ""));
      return node.operator === "-" ? -value : value;
    }
    return undefined;
  }
  if (node.type !== "BinaryExpression" || !["+", "-", "*", "/", "%", "**"].includes(node.operator)) return undefined;
  const left = scalarLiteralValue(node.left);
  const right = scalarLiteralValue(node.right);
  if (typeof left !== "number" || typeof right !== "number") return undefined;
  const value = {
    "+": () => left + right,
    "-": () => left - right,
    "*": () => left * right,
    "/": () => left / right,
    "%": () => left % right,
    "**": () => left ** right,
  }[node.operator]();
  return Number.isFinite(value) ? value : undefined;
}

export const noConstantPin = {
  meta: {
    type: "problem", schema: [], messages: {
      pinned: "tests must not pin an imported constant to a literal; assert the behavior the value controls instead",
    },
  },
  create(context) {
    const filename = String(context.filename ?? "").replaceAll("\\", "/");
    if (/\.stories\.[^/]+$/u.test(filename)) return {};
    if (!testFileSuffix.test(filename) && !/(?:^|\/)(?:tests|testing)\//u.test(filename)
      && !/(?:^|\/)[^/]*test-harness\.(?:ts|tsx)$/u.test(filename)
      && !/(?:^|\/)[^/]*smoke-fixture[^/]*\.(?:ts|tsx)$/u.test(filename)) return {};
    return {
      CallExpression(node) {
        let callee = node.callee;
        const members = [];
        while (callee?.type === "MemberExpression" && !callee.computed
          && callee.property.type === "Identifier") {
          members.push(callee.property.name);
          callee = callee.object;
        }
        if (members.length !== 1 || !["toBe", "toEqual", "toStrictEqual"].includes(members[0])
          || callee?.type !== "CallExpression" || callee.callee.type !== "Identifier"
          || callee.callee.name !== "expect") return;
        const actual = unwrapBindingExpression(callee.arguments[0]);
        if (actual?.type !== "Identifier"
          || !/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/u.test(actual.name)
          || !resolveVariable(context.sourceCode, actual)?.defs.some((definition) => definition.type === "ImportBinding")) return;
        const expected = node.arguments[0];
        const value = scalarLiteralValue(expected);
        if (value === undefined
          || /(?:^|_)(?:CHAIN_ID|NETWORK_ID|ADDRESS|ADDRESSES|ENDPOINT|ENDPOINTS|URL|URLS|URI|PATH|PATHS|HOST|ORIGIN|VERSION)$/u.test(actual.name)
          || typeof value === "string" && (/^0x[\da-f]{40}$/iu.test(value)
            || /^(?:https?|wss?):\/\//u.test(value) || value.startsWith("/"))
          || value === 8453 || value === 84532) return;
        context.report({ node: expected, messageId: "pinned" });
      },
    };
  },
};

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
export const noComputedStyleInComponentTests = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      rejected: "Component tests and stories must assert behavior, not computed styles; browser geometry belongs in Playwright.",
    },
  },
  create(context) {
    if (!/\.(?:test|stories)\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/u.test(String(context.filename ?? ""))) return {};
    return {
      CallExpression(node) {
        const callee = node.callee;
        const direct = callee.type === "Identifier" && callee.name === "getComputedStyle";
        const member = callee.type === "MemberExpression"
          && (callee.object.type === "Identifier"
            && ["window", "globalThis"].includes(callee.object.name))
          && (callee.computed
            ? callee.property.type === "Literal" && callee.property.value === "getComputedStyle"
            : callee.property.type === "Identifier" && callee.property.name === "getComputedStyle");
        if (direct || member) context.report({ node, messageId: "rejected" });
      },
    };
  },
};
