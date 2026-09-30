import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, extname } from "node:path";

const requireWeb = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { loadCsf } = requireWeb("storybook/internal/csf-tools");
const { babelParse, traverse, types: t } = requireWeb("storybook/internal/babel");

const storyExtensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
export const storyGlobs = [
  "../{client,components}/**/*.stories.@(js|jsx|mjs|ts|tsx)",
  "../stories/**/*.stories.@(js|jsx|mjs|ts|tsx)",
];

function unwrapExpression(node) {
  while (node && ["TSAsExpression", "TSSatisfiesExpression", "TSTypeAssertion", "TSNonNullExpression", "ParenthesizedExpression"].includes(node.type)) node = node.expression;
  return node;
}

function memberNamed(node, name) {
  return (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) && (node.computed
    ? t.isStringLiteral(node.property, { value: name }) : t.isIdentifier(node.property, { name }));
}

function safeParameters(node) {
  return t.isObjectExpression(node) && node.properties.every((property) =>
    !t.isSpreadElement(property) && !property.computed &&
    !t.isIdentifier(property.key, { name: "__id" }) && !t.isStringLiteral(property.key, { value: "__id" }));
}

function indexerStoryNode(node) {
  if (t.isTSAsExpression(node) && t.isTSSatisfiesExpression(node.expression)) return node.expression.expression;
  if (t.isTSAsExpression(node) || t.isTSSatisfiesExpression(node)) return node.expression;
  return node;
}

function definitelyNotObject(node) {
  const current = unwrapExpression(node);
  return t.isLiteral(current) || t.isTemplateLiteral(current) || t.isArrayExpression(current) || t.isFunction(current) ||
    t.isBinaryExpression(current) || t.isUnaryExpression(current) || t.isUpdateExpression(current);
}

function propertyName(property) {
  return t.isIdentifier(property.key) ? property.key.name : t.isStringLiteral(property.key) ? property.key.value : null;
}

function identityWrite(target) {
  for (let node = target; t.isMemberExpression(node) || t.isOptionalMemberExpression(node); node = unwrapExpression(node.object)) {
    if (memberNamed(node, "parameters") || memberNamed(node, "story") || memberNamed(node, "__id")) return true;
    if (node.computed && !t.isStringLiteral(node.property)) return true;
  }
  return false;
}

function writtenBindings(programPath) {
  const written = new Set();
  const aliases = new Map();
  const aliasSources = (node) => {
    const current = unwrapExpression(node);
    if (t.isIdentifier(current)) return [current];
    if (t.isSequenceExpression(current) && current.expressions.length) return aliasSources(current.expressions.at(-1));
    if (t.isConditionalExpression(current) || t.isLogicalExpression(current)) {
      return [...aliasSources(current.consequent ?? current.left), ...aliasSources(current.alternate ?? current.right)];
    }
    return [];
  };
  const addAlias = (scope, left, right) => {
    const target = unwrapExpression(left);
    if (!t.isIdentifier(target)) return;
    const targetBinding = scope.getBinding(target.name);
    if (!targetBinding) return;
    for (const source of aliasSources(right)) {
      const sourceBinding = scope.getBinding(source.name);
      if (!sourceBinding) continue;
      for (const [from, to] of [[targetBinding, sourceBinding], [sourceBinding, targetBinding]]) {
        const edges = aliases.get(from) ?? new Set();
        edges.add(to);
        aliases.set(from, edges);
      }
    }
  };
  const record = (path, node) => {
    for (const target of memberWriteTargets(node)) {
      if (!identityWrite(target)) continue;
      let root = target;
      while (t.isMemberExpression(root) || t.isOptionalMemberExpression(root)) root = unwrapExpression(root.object);
      if (!t.isIdentifier(root)) continue;
      const binding = path.scope.getBinding(root.name);
      if (binding) written.add(binding);
    }
  };
  programPath.traverse({
    VariableDeclarator(path) { addAlias(path.scope, path.node.id, path.node.init); },
    AssignmentExpression(path) { record(path, path.node.left); addAlias(path.scope, path.node.left, path.node.right); },
    UpdateExpression(path) { record(path, path.node.argument); },
    UnaryExpression(path) { if (path.node.operator === "delete") record(path, path.node.argument); },
    "ForInStatement|ForOfStatement"(path) { record(path, path.node.left); },
  });
  const queue = [...written];
  while (queue.length) {
    for (const alias of aliases.get(queue.pop()) ?? []) if (!written.has(alias) && written.add(alias)) queue.push(alias);
  }
  return written;
}

// A local that is reassigned or mutated can gain an `__id` the static index cannot see.
function unstableIdentifier(node, scope, written) {
  const current = unwrapExpression(node);
  if (!t.isIdentifier(current)) return false;
  const binding = scope.getBinding(current.name);
  return Boolean(binding) && (!binding.constant || written.has(binding));
}

// Resolve a chain of local aliases to the object literal it ends at, without recursing.
function literalObject(node, scope, seen) {
  const chain = [];
  try {
    let current = unwrapExpression(node);
    while (!t.isObjectExpression(current)) {
      if (!t.isIdentifier(current) || seen.has(current)) return null;
      const binding = scope.getBinding(current.name);
      if (!binding || seen.has(binding) || !binding.constant || !t.isVariableDeclarator(binding.path.node) ||
        !t.isIdentifier(binding.path.node.id)) return null;
      seen.add(binding);
      chain.push(binding);
      scope = binding.path.scope;
      current = unwrapExpression(binding.path.node.init);
    }
    return current;
  } finally {
    for (const binding of chain) seen.delete(binding);
  }
}

// Every object literal an initializer can evaluate to, or null when it cannot be analysed.
function expressionObjects(node, scope, seen, written) {
  const current = unwrapExpression(node);
  if (t.isObjectExpression(current)) return [current];
  if (t.isIdentifier(current)) {
    const binding = scope.getBinding(current.name);
    if (!binding || seen.has(binding) || written.has(binding) || !binding.constant || !t.isVariableDeclarator(binding.path.node) ||
      !t.isIdentifier(binding.path.node.id)) return null;
    seen.add(binding);
    try {
      return expressionObjects(binding.path.node.init, binding.path.scope, seen, written);
    } finally {
      seen.delete(binding);
    }
  }
  if (t.isConditionalExpression(current) || t.isLogicalExpression(current)) {
    const branches = [];
    for (const branch of [current.consequent ?? current.left, current.alternate ?? current.right]) {
      const resolved = expressionObjects(branch, scope, new Set(seen), written);
      if (!resolved) return null;
      branches.push(...resolved);
    }
    return branches;
  }
  if (t.isSequenceExpression(current) && current.expressions.length) return expressionObjects(current.expressions.at(-1), scope, seen, written);
  return null;
}

function cached(memo, tag, object, direct, compute) {
  const entry = memo.get(object) ?? {};
  const key = `${tag}${direct ? "d" : "i"}`;
  if (!(key in entry)) entry[key] = compute();
  memo.set(object, entry);
  return entry[key];
}

// Storybook's static index reads `parameters.__id` only from a literal object with a bare
// identifier key and a string value, while its runtime resolves the same field with `||`
// and also reads the deprecated `story` annotation. Anything else can diverge.
function parametersCarryId(object, scope, direct, written, seen, memo) {
  if (seen.has(object)) return true;
  seen.add(object);
  try {
    return cached(memo, "parameters", object, direct, () => {
      let ids = 0;
      for (const property of object.properties) {
        if (t.isSpreadElement(property)) {
          if (unstableIdentifier(property.argument, scope, written)) return true;
          const spread = literalObject(property.argument, scope, seen);
          if (!spread || seen.has(spread)) return true;
          if (parametersCarryId(spread, scope, false, written, seen, memo)) return true;
          continue;
        }
        if (property.computed) return true;
        const name = propertyName(property);
        if (name === "__proto__") return true;
        if (name !== "__id") continue;
        if (!t.isObjectProperty(property) || !direct || !t.isIdentifier(property.key) || ids++) return true;
        const value = property.value;
        if (unstableIdentifier(value, scope, written)) return true;
        if (t.isNullLiteral(value) || t.isIdentifier(value, { name: "undefined" }) && !scope.getBinding("undefined")) continue;
        if (!t.isStringLiteral(value) || (direct ? !value.value : Boolean(value.value))) return true;
      }
      return false;
    });
  } finally {
    seen.delete(object);
  }
}

function hasInlineId(object) {
  return object.properties.some((property) => t.isObjectProperty(property) && !property.computed && t.isIdentifier(property.key, { name: "__id" }));
}

// A modeled `__id` is only trustworthy when nothing later in the annotation replaces `parameters`.
function laterReplacesParameters(properties, index) {
  return properties.slice(index + 1).some((property) => t.isSpreadElement(property) || propertyName(property) === "parameters");
}

function annotationCarriesId(object, scope, direct, written, seen, memo) {
  if (seen.has(object)) return true;
  seen.add(object);
  try {
    return cached(memo, "annotation", object, direct, () => {
      const properties = object.properties;
      for (let index = 0; index < properties.length; index++) {
        const property = properties[index];
        if (t.isSpreadElement(property)) {
          if (unstableIdentifier(property.argument, scope, written)) return true;
          const spread = literalObject(property.argument, scope, seen);
          if (!spread) continue;
          if (annotationCarriesId(spread, scope, false, written, seen, memo)) return true;
          continue;
        }
        if (property.computed) return true;
        const name = propertyName(property);
        if (name === "__proto__") return true;
        if (name !== "parameters" && name !== "story") continue;
        if (unstableIdentifier(property.value, scope, written)) return true;
        const value = literalObject(property.value, scope, seen);
        if (!value) {
          if (definitelyNotObject(property.value)) continue;
          return true;
        }
        if (name === "story") {
          if (annotationCarriesId(value, scope, false, written, seen, memo)) return true;
          continue;
        }
        const directParameters = direct && t.isIdentifier(property.key) && t.isObjectExpression(property.value);
        if (parametersCarryId(value, scope, directParameters, written, seen, memo)) return true;
        if (hasInlineId(value) && laterReplacesParameters(properties, index)) return true;
      }
      return false;
    });
  } finally {
    seen.delete(object);
  }
}

function inlineStoryIdFindings(csf, indexInputs, report) {
  const names = new Set(indexInputs.map((story) => story.exportName));
  traverse(csf._ast, {
    Program(path) {
      const bindings = new Map();
      const declared = new Set();
      const exportedNames = new Set();
      const add = (local, exported, fromDeclaration) => {
        const binding = path.scope.getBinding(local);
        if (!names.has(exported) || !binding) return;
        if (exportedNames.has(exported)) declared.delete(exported);
        else {
          exportedNames.add(exported);
          if (fromDeclaration) declared.add(exported);
        }
        bindings.set(exported, binding);
      };
      for (const statement of path.node.body) {
        if (!t.isExportNamedDeclaration(statement) || statement.source) continue;
        if (statement.declaration) for (const name of Object.keys(t.getBindingIdentifiers(statement.declaration))) add(name, name, true);
        for (const specifier of statement.specifiers) if (t.isExportSpecifier(specifier)) add(specifier.local.name, specifier.exported.name ?? specifier.exported.value, false);
      }
      const written = writtenBindings(path);
      const memo = new Map();
      const reported = new Set();
      for (const [exported, binding] of bindings) {
        const declaration = binding.path.node;
        if (!t.isVariableDeclarator(declaration)) continue;
        const annotations = expressionObjects(declaration.init, binding.path.scope, new Set(), written);
        if (!annotations) {
          // Calls and functions cannot be inspected here; every other unstatically resolvable
          // initializer could be an object the index never saw.
          const unwrapped = unwrapExpression(declaration.init);
          if (!t.isCallExpression(unwrapped) && !definitelyNotObject(declaration.init)) report(declaration.init, "unmodeled story __id");
          continue;
        }
        const direct = declared.has(exported) && t.isObjectExpression(indexerStoryNode(declaration.init));
        for (const annotation of annotations) {
          if (reported.has(annotation)) continue;
          if (annotationCarriesId(annotation, binding.path.scope, direct, written, new Set(), memo)) {
            reported.add(annotation);
            report(annotation, "unmodeled story __id");
          }
        }
      }
    },
  });
}

function memberWriteTargets(node) {
  node = unwrapExpression(node);
  if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) return [node];
  if (t.isArrayPattern(node)) return node.elements.flatMap(memberWriteTargets);
  if (t.isObjectPattern(node)) return node.properties.flatMap((property) =>
    memberWriteTargets(t.isRestElement(property) ? property.argument : property.value));
  if (t.isAssignmentPattern(node)) return memberWriteTargets(node.left);
  if (t.isRestElement(node)) return memberWriteTargets(node.argument);
  return [];
}

function storyAssignmentFindings(csf, indexInputs, report) {
  const names = new Set(indexInputs.map((story) => story.exportName));
  const exportedBindings = new Set();
  const bindings = new Set();
  const inlineIds = new Set();
  const reported = new Set();
  const reportWrite = (node) => {
    if (reported.has(node)) return;
    reported.add(node);
    report(node, "unmodeled story __id");
  };
  const checkWrites = (path, left) => {
    for (const target of memberWriteTargets(left)) {
      const members = [];
      let root = target;
      while (t.isMemberExpression(root) || t.isOptionalMemberExpression(root)) {
        members.push(root);
        root = unwrapExpression(root.object);
      }
      if (!t.isIdentifier(root)) continue;
      const binding = path.scope.getBinding(root.name);
      if (!bindings.has(binding)) continue;
      const parameterField = members.at(-2);
      if (members.length >= 2 && memberNamed(members.at(-1), "parameters") &&
        ((!parameterField.computed && t.isIdentifier(parameterField.property)) || t.isStringLiteral(parameterField.property)) &&
        !memberNamed(parameterField, "__id")) continue;
      if (!members.some((member) => ["parameters", "story", "__id"].some((name) => memberNamed(member, name)) ||
        (member.computed && !t.isStringLiteral(member.property)))) continue;
      const safe = !inlineIds.has(binding) && members.length === 1 && memberNamed(target, "parameters") && !target.computed &&
        t.isAssignmentExpression(path.node, { operator: "=" }) && unwrapExpression(path.node.left) === target &&
        safeParameters(unwrapExpression(path.node.right));
      if (!safe) reportWrite(path.node);
    }
  };
  traverse(csf._ast, {
    Program(path) {
      const parents = new Map();
      const find = (binding) => {
        if (!parents.has(binding)) parents.set(binding, binding);
        let root = binding;
        while (parents.get(root) !== root) root = parents.get(root);
        while (binding !== root) {
          const parent = parents.get(binding);
          parents.set(binding, root);
          binding = parent;
        }
        return root;
      };
      const add = (local, exported) => {
        const binding = path.scope.getBinding(local);
        if (!names.has(exported) || !binding) return;
        exportedBindings.add(binding);
        find(binding);
      };
      for (const statement of path.node.body) {
        if (!t.isExportNamedDeclaration(statement) || statement.source) continue;
        if (statement.declaration) {
          for (const name of Object.keys(t.getBindingIdentifiers(statement.declaration))) add(name, name);
        }
        for (const specifier of statement.specifiers) {
          if (t.isExportSpecifier(specifier)) add(specifier.local.name, specifier.exported.name ?? specifier.exported.value);
        }
      }
      const addAlias = (scope, target, source) => {
        target = unwrapExpression(target);
        source = unwrapExpression(source);
        if (!t.isIdentifier(target) || !t.isIdentifier(source)) return;
        const targetBinding = scope.getBinding(target.name);
        const sourceBinding = scope.getBinding(source.name);
        if (targetBinding && sourceBinding) parents.set(find(targetBinding), find(sourceBinding));
      };
      path.traverse({
        VariableDeclarator(path) {
          addAlias(path.scope, path.node.id, path.node.init);
          const init = unwrapExpression(path.node.init);
          if (!t.isIdentifier(path.node.id) || !t.isObjectExpression(init)) return;
          const hasInlineId = init.properties.some((property) => {
            if (!t.isObjectProperty(property) || property.computed ||
              !(t.isIdentifier(property.key, { name: "parameters" }) || t.isStringLiteral(property.key, { value: "parameters" }))) return false;
            const parameters = unwrapExpression(property.value);
            return t.isObjectExpression(parameters) && parameters.properties.some((annotation) =>
              !t.isSpreadElement(annotation) && !annotation.computed &&
              (t.isIdentifier(annotation.key, { name: "__id" }) || t.isStringLiteral(annotation.key, { value: "__id" })));
          });
          const binding = path.scope.getBinding(path.node.id.name);
          if (hasInlineId && binding) inlineIds.add(binding);
        },
        AssignmentExpression(path) {
          addAlias(path.scope, path.node.left, path.node.right);
        },
      });
      const trackedComponents = new Set([...exportedBindings].map(find));
      const inlineComponents = new Set([...inlineIds].map(find));
      for (const binding of parents.keys()) {
        const component = find(binding);
        if (trackedComponents.has(component)) bindings.add(binding);
        if (inlineComponents.has(component)) inlineIds.add(binding);
      }
      for (const binding of bindings) {
        for (const violation of binding.constantViolations) reportWrite(violation.node);
      }
    },
    AssignmentExpression(path) {
      checkWrites(path, path.node.left);
    },
    UpdateExpression(path) {
      checkWrites(path, path.node.argument);
    },
    UnaryExpression(path) {
      if (path.node.operator === "delete") checkWrites(path, path.node.argument);
    },
    "ForInStatement|ForOfStatement"(path) {
      checkWrites(path, path.node.left);
    },
  });
}

function lineAt(content, offset) {
  return content.slice(0, Math.max(offset, 0)).split("\n").length;
}

export function storyIdsFromFiles(files) {
  const ids = new Set();
  const findings = [];
  for (const file of files) {
    const report = (node, message) => findings.push(`${file.path}:${node?.loc?.start?.line ?? lineAt(file.content, node?.start ?? 0)}: ${message}`);
    const start = findings.length;
    let csf;
    let parseError;
    try {
      csf = loadCsf(file.content, { fileName: file.path, makeTitle: (title) => title });
      traverse(csf._ast, {
        ExportDeclaration(path) {
          if (!path.parentPath.isProgram() || path.listKey !== "body") report(path.node, "unmodeled nested export");
        },
      });
      if (findings.length !== start) continue;
      csf.parse();
    } catch (error) {
      parseError = error;
    }
    if (t.isObjectExpression(csf?._metaNode)) {
      if (csf._metaNode.properties.some((property) => t.isSpreadElement(property) || property.computed)) {
        report(csf._metaNode, "unmodeled story meta");
        continue;
      }
      for (const property of csf._metaNode.properties) {
        const key = t.isIdentifier(property.key) ? property.key.name : property.key.value;
        if (!["includeStories", "excludeStories"].includes(key)) continue;
        const value = property.value;
        if (!(t.isArrayExpression(value) && value.elements.every((element) => t.isStringLiteral(element))) &&
          !t.isRegExpLiteral(value) && !t.isStringLiteral(value)) report(property, `unmodeled ${key} filter`);
      }
      const fields = csf._metaNode.properties.filter((property) =>
        t.isIdentifier(property.key) && ["id", "title"].includes(property.key.name));
      for (const field of fields) {
        if (!t.isStringLiteral(field.value)) report(field, `story meta has nonliteral ${field.key.name}`);
      }
      if (findings.length === start && !fields.some((field) => field.value.value.trim())) {
        report(csf._metaNode, "story meta has no literal id or title");
      }
    }
    if (findings.length !== start) continue;
    if (parseError) {
      const message = parseError.message.split("\n")[0];
      const line = parseError.loc?.line ?? /\bline (\d+)/.exec(message)?.[1];
      findings.push(`${file.path}${line ? `:${line}` : ""}: ${message}`);
      continue;
    }
    const indexInputs = csf.indexInputs;
    if (indexInputs.some((story) => typeof story.__id !== "string")) {
      findings.push(`${file.path}:1: unmodeled story __id`);
      continue;
    }
    // Both guards are static analyses of arbitrary user code, so an analyzer failure fails the file closed.
    try {
      storyAssignmentFindings(csf, indexInputs, report);
      if (findings.length === start) inlineStoryIdFindings(csf, indexInputs, report);
    } catch {
      findings.push(`${file.path}:1: unmodeled story __id`);
    }
    if (findings.length === start) for (const story of indexInputs) ids.add(story.__id);
  }
  return { ids, findings };
}

export function storyReferenceFindings({ storyFiles, boards, docs }) {
  const { ids, findings } = storyIdsFromFiles(storyFiles);
  const boardFrames = new Map();
  const report = (file, offset, message) => findings.push(`${file.path}:${lineAt(file.content, offset)}: ${message}`);
  for (const file of boards) {
    const board = JSON.parse(file.content);
    if (boardFrames.has(board.id)) report(file, file.content.indexOf('"id"'), `duplicate board ${board.id}`);
    if (!ids.has(`review-boards--${board.id}`)) report(file, file.content.indexOf('"id"'), `unresolved board review-boards--${board.id}`);
    const frames = new Set();
    let cursor = 0;
    for (const section of board.sections ?? []) for (const frame of section.frames ?? []) {
      const idOffset = file.content.indexOf(`"id": "${frame.id}"`, cursor);
      if (idOffset >= 0) cursor = idOffset + 1;
      if (frames.has(frame.id)) report(file, idOffset, `duplicate frame ${frame.id}`);
      frames.add(frame.id);
      for (const key of ["story", "before"]) {
        if (frame[key] && !ids.has(frame[key])) report(file, file.content.indexOf(`"${key}": "${frame[key]}"`, cursor), `unresolved ${key} ${frame[key]}`);
      }
    }
    if (!boardFrames.has(board.id)) boardFrames.set(board.id, frames);
  }
  for (const file of [...storyFiles, ...boards, ...docs]) {
    for (const match of file.content.matchAll(/\?id=([^\s"'`<>)]*)/g)) {
      const query = match[1];
      const raw = query.split(/[&#]/)[0];
      let id;
      try { id = decodeURIComponent(raw); }
      catch {
        if (raw.includes("--")) report(file, match.index, `unmodeled link id ${raw}`);
        continue;
      }
      if (!id.includes("--")) continue;
      if (!ids.has(id)) {
        const stripped = id.replace(/[.,;:!?]$/, "");
        if (ids.has(stripped)) id = stripped;
        else report(file, match.index, `unresolved link id ${id}`);
      }
      const rawFrame = /(?:^|&(?:amp;)?)frame=([^&\s"'`<>)]*)/.exec(query)?.[1];
      if (!rawFrame || !id.startsWith("review-boards--")) continue;
      let frame;
      try { frame = decodeURIComponent(rawFrame.split("#")[0]); }
      catch { report(file, match.index, `unmodeled frame ${rawFrame} on ${id}`); continue; }
      const board = id.slice("review-boards--".length);
      const knownFrames = board === "changes" ? ids : boardFrames.get(board);
      if (knownFrames && !knownFrames.has(frame)) {
        const stripped = frame.replace(/[.,;:!?]$/, "");
        if (knownFrames.has(stripped)) frame = stripped;
        else report(file, match.index, `unresolved frame ${frame} on ${id}`);
      }
    }
  }
  for (const file of docs) {
    let kind = null;
    for (const match of file.content.matchAll(/`(?:([\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*)--([\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*|\*)|--([\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*))`/gu)) {
      if (match[1]) kind = match[1];
      else if (!kind) { report(file, match.index, `orphan inventory shorthand --${match[3]}`); continue; }
      const id = `${kind}--${match[2] ?? match[3]}`;
      if (id.endsWith("--*") ? ![...ids].some((story) => story.startsWith(id.slice(0, -1))) : !ids.has(id)) {
        report(file, match.index, `unresolved inventory id ${id}`);
      }
    }
  }
  return findings;
}

function filesIn(root, dir, predicate) {
  const files = [];
  function walk(directory) {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!["node_modules", ".next", "storybook-static", "test-results", "playwright-report"].includes(entry.name)) walk(join(directory, entry.name));
      } else if (predicate(entry.name)) {
        const absolute = join(root, directory, entry.name);
        files.push({ path: relative(root, absolute).split("\\").join("/"), content: readFileSync(absolute, "utf8") });
      }
    }
  }
  walk(dir);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function storyGlobFindings(configPath, configSource) {
  const declarations = [];
  try {
    traverse(babelParse(configSource), {
      ObjectProperty({ node }) {
        if (node.computed || !(t.isIdentifier(node.key, { name: "stories" }) || t.isStringLiteral(node.key, { value: "stories" }))) return;
        declarations.push(t.isArrayExpression(node.value) && node.value.elements.every((element) => t.isStringLiteral(element))
          ? node.value.elements.map((element) => element.value) : null);
      },
    });
  } catch {
    declarations.push(null);
  }
  if (declarations.length !== 1 || !declarations[0] || declarations[0].length !== storyGlobs.length ||
    declarations[0].some((glob, index) => glob !== storyGlobs[index])) {
    return [`${configPath}:1: Storybook stories must be a literal array matching gate globs`];
  }
  return [];
}

function repositoryStoryFiles(repoRoot) {
  return ["client", "components", "stories"].flatMap((dir) =>
    filesIn(repoRoot, `apps/web/${dir}`, (name) => storyExtensions.has(extname(name)) && name.endsWith(`.stories${extname(name)}`)));
}

export function repositoryStoryReferenceFindings(repoRoot) {
  const storyFiles = repositoryStoryFiles(repoRoot);
  const boards = filesIn(repoRoot, "apps/web/stories/review/boards", (name) => name.endsWith(".json"));
  const docs = filesIn(repoRoot, "docs/design-system/stories", (name) => name.endsWith(".md"));
  const configPath = "apps/web/.storybook/main.ts";
  return [...storyGlobFindings(configPath, readFileSync(join(repoRoot, configPath), "utf8")), ...storyReferenceFindings({ storyFiles, boards, docs })];
}

export function repositoryStoryIds(repoRoot) {
  return storyIdsFromFiles(repositoryStoryFiles(repoRoot)).ids;
}
