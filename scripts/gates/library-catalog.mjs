import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const requireWeb = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { build } = createRequire(requireWeb.resolve("vite"))("esbuild");
const { loadCsf } = requireWeb("storybook/internal/csf-tools");
const { babelParse, traverse, types: t } = requireWeb("storybook/internal/babel");
const { combineParameters } = requireWeb("storybook/internal/preview-api");
const webRoot = fileURLToPath(new URL("../../apps/web/", import.meta.url));
const missing = Symbol("missing");

// Compile the existing plugin for Node 22 without introducing another import walker.
export async function libraryWalkers() {
  const plugin = new URL("../../apps/web/.storybook/library-imports-plugin.ts", import.meta.url);
  const result = await build({
    entryPoints: [fileURLToPath(plugin)], bundle: true, write: false, format: "esm", platform: "node",
    define: { "import.meta.url": JSON.stringify(plugin.href) },
    plugins: [{ name: "gate-runtime-imports", setup(builder) {
      builder.onResolve({ filter: /^(?:node:|[^./])/ }, ({ path, kind }) => {
        if (kind === "entry-point") return;
        return { path: path.startsWith("node:") ? path : pathToFileURL(requireWeb.resolve(path)).href, external: true };
      });
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

export function coverageFindings(components, compositions, product, notUsed) {
  const covered = new Set(Object.values(compositions).flat());
  const used = new Set(product);
  const listed = new Set(notUsed);
  const findings = [];
  if (listed.size !== notUsed.length) findings.push("Duplicate product-unused catalog entries");
  for (const name of notUsed) {
    if (!components.has(name)) findings.push(`Unknown product-unused catalog component: ${name}`);
    else if (used.has(name)) findings.push(`Listed component is used in product: ${name}`);
  }
  for (const [name, id] of components) {
    if (!used.has(name) && !listed.has(name)) findings.push(`Product-unused catalog component missing from reviewed list: ${name}`);
    if (used.has(name) && !covered.has(name)) findings.push(`Product-used catalog component not reached by any composition: ${name} (${id})`);
  }
  return findings;
}

function unwrap(node, scope, seen = new Set(), objects = new Set()) {
  while (node) {
    if (["TSAsExpression", "TSSatisfiesExpression", "TSTypeAssertion", "TSNonNullExpression", "ParenthesizedExpression"].includes(node.type)) {
      node = node.expression;
    } else if (t.isIdentifier(node) && node.name !== "undefined") {
      const binding = scope.getBinding(node.name);
      if (!binding || !binding.constant || seen.has(binding) || !t.isVariableDeclarator(binding.path.node) || !t.isIdentifier(binding.path.node.id)) throw new Error(`Unmodeled a11y binding: ${node.name}`);
      seen.add(binding);
      node = binding.path.node.init;
      scope = binding.path.scope;
    } else if (t.isMemberExpression(node)) {
      const key = node.computed ? t.isStringLiteral(node.property) ? node.property.value : null : node.property.name;
      if (key === null) throw new Error("Unmodeled computed a11y reference");
      const value = property(node.object, scope, key, new Set(), objects, seen);
      if (value === missing) throw new Error(`Unmodeled a11y reference: ${key}`);
      return value;
    } else break;
  }
  return { node, scope };
}

function property(node, scope, key, seen = new Set(), objects = new Set(), bindings = new Set()) {
  ({ node, scope } = unwrap(node, scope, bindings, objects));
  if (!t.isObjectExpression(node) || seen.has(node)) throw new Error(`Unmodeled a11y ${key} object`);
  seen.add(node);
  objects.add(node);
  try {
    for (const field of [...node.properties].reverse()) {
      if (t.isSpreadElement(field)) {
        const value = property(field.argument, scope, key, seen, objects, bindings);
        if (value !== missing) return value;
      } else {
        if (field.computed) throw new Error(`Unmodeled computed a11y ${key} property`);
        const name = field.key.name ?? field.key.value;
        if (name === key) {
          if (!t.isObjectProperty(field)) throw new Error(`Unmodeled a11y ${key} property`);
          return unwrap(field.value, scope, new Set(bindings), objects);
        }
      }
    }
    return missing;
  } finally { seen.delete(node); }
}

function a11yParameters(node, scope, objects) {
  const parameters = property(node, scope, "parameters", new Set(), objects);
  if (parameters === missing) return {};
  const a11y = property(parameters.node, parameters.scope, "a11y", new Set(), objects);
  if (a11y === missing) return {};
  if (t.isNullLiteral(a11y.node)) return { a11y: null };
  const test = property(a11y.node, a11y.scope, "test", new Set(), objects);
  if (test === missing) return { a11y: {} };
  if (t.isStringLiteral(test.node)) return { a11y: { test: test.node.value } };
  if (t.isIdentifier(test.node, { name: "undefined" })) return { a11y: { test: undefined } };
  throw new Error("Unmodeled a11y.test value");
}

function rejectParameterMutations(ast, objects) {
  const holdsObject = (node, scope) => {
    try { return objects.has(unwrap(node, scope).node); } catch { return false; }
  };
  const targetsObject = (node, scope) => {
    for (let target = node; target; target = t.isMemberExpression(target) ? target.object : null) {
      if (holdsObject(target, scope)) return true;
    }
    return false;
  };
  const reject = () => { throw new Error("Unmodeled runtime a11y parameter mutation"); };
  traverse(ast, {
    AssignmentExpression({ node, scope }) {
      if (targetsObject(node.left, scope) || holdsObject(node.right, scope)) reject();
    },
    UpdateExpression({ node, scope }) { if (targetsObject(node.argument, scope)) reject(); },
    UnaryExpression({ node, scope }) {
      if (node.operator === "delete" && targetsObject(node.argument, scope)) reject();
    },
    "CallExpression|NewExpression"({ node, scope }) { if (targetsObject(node.callee, scope)) reject(); },
    TaggedTemplateExpression({ node, scope }) { if (targetsObject(node.tag, scope)) reject(); },
    "Identifier|MemberExpression"(path) {
      if (path.isIdentifier() && !path.isReferencedIdentifier() || !holdsObject(path.node, path.scope)) return;
      while (["TSAsExpression", "TSSatisfiesExpression", "TSTypeAssertion", "TSNonNullExpression", "ParenthesizedExpression"].includes(path.parentPath?.node.type)) path = path.parentPath;
      const parent = path.parentPath;
      if (parent?.isTSTypeQuery() || parent?.isMemberExpression() && parent.node.object === path.node) return;
      if (parent?.isVariableDeclarator() && parent.node.init === path.node &&
        t.isIdentifier(parent.node.id) && parent.scope.getBinding(parent.node.id.name)?.constant) return;
      if (parent?.isObjectProperty() && parent.node.value === path.node && objects.has(parent.parentPath.node) ||
        parent?.isSpreadElement() && objects.has(parent.parentPath.node) || parent?.isExportDefaultDeclaration()) return;
      reject();
    },
  });
}

function programScope(ast) {
  let scope;
  traverse(ast, { Program(path) { scope = path.scope; } });
  return scope;
}

export function compositionA11yFindings(files, previewSource, exemptions) {
  const findings = [];
  const exempt = new Map();
  for (const entry of exemptions) {
    if (!entry || typeof entry.storyId !== "string" || !entry.storyId || !Number.isSafeInteger(entry.issue) || entry.issue <= 0 || exempt.has(entry.storyId)) {
      findings.push("Invalid or duplicate composition a11y exemption (requires storyId and positive issue)");
    } else exempt.set(entry.storyId, entry.issue);
  }
  const previewAst = babelParse(previewSource);
  const previewScope = programScope(previewAst);
  const previewDefault = previewAst.program.body.find((node) => t.isExportDefaultDeclaration(node));
  if (!previewDefault) throw new Error("Missing Storybook preview default export");
  const previewObjects = new Set();
  const preview = a11yParameters(previewDefault.declaration, previewScope, previewObjects);
  rejectParameterMutations(previewAst, previewObjects);
  const seen = new Set();
  for (const { path, content } of files) {
    try {
      const csf = loadCsf(content, { fileName: path, makeTitle: (title) => title }).parse();
      const scope = programScope(csf._ast);
      const objects = new Set();
      const meta = a11yParameters(csf._metaNode, scope, objects);
      for (const { exportName, __id: id } of csf.indexInputs) {
        seen.add(id);
        const declaration = csf._storyExports[exportName];
        const annotation = t.isVariableDeclarator(declaration) ? declaration.init : declaration;
        const story = t.isFunction(annotation) ? {} : a11yParameters(annotation, scope, objects);
        if (t.isFunction(annotation)) objects.add(annotation);
        const test = combineParameters(preview, meta, story).a11y?.test;
        const expected = exempt.has(id) ? "todo" : "error";
        if (test !== expected) findings.push(`${path}: ${id} resolves to a11y.test ${JSON.stringify(test)}, expected ${expected}`);
      }
      rejectParameterMutations(csf._ast, objects);
    } catch (error) { findings.push(`${path}: ${error.message}`); }
  }
  if (!seen.size) findings.push("No composition stories found");
  for (const id of exempt.keys()) if (!seen.has(id)) findings.push(`Stale composition a11y exemption: ${id}`);
  return findings;
}

export async function repositoryLibraryCatalogFindings(root = webRoot, policyDirectory = fileURLToPath(new URL("./", import.meta.url))) {
  const { compositionUiImports, productUiImports } = await libraryWalkers();
  const components = new Map();
  const ui = join(root, "components/ui");
  for (const name of readdirSync(ui).filter((name) => name.endsWith(".stories.tsx")).sort()) {
    const csf = loadCsf(readFileSync(join(ui, name), "utf8"), { makeTitle: (title) => title }).parse();
    if (csf.meta.title?.startsWith("UI/") && csf.stories.length) components.set(name.slice(0, -".stories.tsx".length), csf.stories[0].id.split("--")[0]);
  }
  if (!components.size) throw new Error("No Library catalog components found");
  const directory = join(root, "stories/review/compositions");
  const stories = readdirSync(directory).filter((name) => name.endsWith(".stories.tsx")).sort()
    .map((name) => ({ path: join(directory, name), content: readFileSync(join(directory, name), "utf8") }));
  const notUsed = JSON.parse(readFileSync(join(policyDirectory, "library-catalog-not-used.json"), "utf8"));
  const exemptions = JSON.parse(readFileSync(join(policyDirectory, "library-composition-a11y-exemptions.json"), "utf8"));
  if (!Array.isArray(notUsed) || !notUsed.every((name) => typeof name === "string") || !Array.isArray(exemptions)) throw new Error("Invalid Library catalog policy lists");
  return [
    ...coverageFindings(components, await compositionUiImports(root), await productUiImports(root), notUsed),
    ...compositionA11yFindings(stories, readFileSync(join(root, ".storybook/preview.tsx"), "utf8"), exemptions),
  ];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = process.argv[2] === "--web-root" ? resolve(process.argv[3]) : webRoot;
    const findings = await repositoryLibraryCatalogFindings(root);
    for (const finding of findings) console.error(finding);
    if (findings.length) process.exitCode = 1;
    else console.log("Library catalog gate passed (composition coverage, product-unused list, strict a11y)");
  } catch (error) { console.error(`Library catalog gate: ${error.message}`); process.exitCode = 1; }
}
