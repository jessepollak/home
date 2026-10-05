import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  analyzeStaticReachability,
  deferredShellModules,
  discoverShellEntryRoots,
  formatShellDeferredFindings,
  shellDeferredViolations,
  shellEntryRoots,
  staticImportSpecifiers,
} from "../shell-deferred-imports.mjs";

const entry = "apps/web/app/(shell)/layout.tsx";
const deferredPath = "apps/web/client/flow/dialog.tsx";
const deferred = [{ path: deferredPath, flow: "Test flow" }];
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const cli = fileURLToPath(new URL("../shell-deferred-imports.mjs", import.meta.url));

function analyze(files, options = {}) {
  const map = new Map(Object.entries(files));
  return analyzeStaticReachability({
    roots: [entry], deferred,
    has: (file) => map.has(file),
    read: (file) => {
      assert.ok(map.has(file), `read only resolved files: ${file}`);
      return map.get(file);
    },
    ...options,
  });
}

function assertClean(result) {
  assert.deepEqual(result.violations, [], formatShellDeferredFindings(result).join("\n"));
  assert.deepEqual(result.unresolved, [], formatShellDeferredFindings(result).join("\n"));
  assert.deepEqual(result.missingDeferred, [], formatShellDeferredFindings(result).join("\n"));
  assert.deepEqual(result.unlistedRoots ?? [], [], formatShellDeferredFindings(result).join("\n"));
}

function fixtureRoot(t, files) {
  const root = mkdtempSync(path.join(tmpdir(), "shell-deferred-imports-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

test("a static chain reports the deferred module, full chain and offending import", () => {
  const importer = "apps/web/client/flow/trigger.tsx";
  const result = analyze({
    [entry]: 'import { Trigger } from "@/client/flow/trigger";',
    [importer]: 'import { Dialog } from "./dialog";',
    [deferredPath]: "export const Dialog = () => null;",
  });
  assert.deepEqual(result.violations, [{
    path: deferredPath, flow: "Test flow", chain: [entry, importer, deferredPath],
    importer, specifier: "./dialog",
  }]);
  assert.deepEqual([...result.reachable], [entry, importer, deferredPath]);
  assert.deepEqual(formatShellDeferredFindings(result), [
    `${deferredPath} (Test flow) is statically reachable from the authenticated shell.\n  Import chain: ${entry} -> ${importer} -> ${deferredPath}\n  ${importer} imports "./dialog"`,
  ]);
});

for (const loader of ["deferSheet", "deferStep", "dynamic"]) {
  test(`import() inside ${loader} breaks static reachability`, () => {
    const result = analyze({
      [entry]: `import dynamic from "next/dynamic";\nconst Flow = ${loader}(() => import("@/client/flow/dialog").then(m => m.Dialog));`,
      [deferredPath]: "export const Dialog = () => null;",
    });
    assertClean(result);
    assert.deepEqual([...result.reachable], [entry]);
  });
}

for (const content of [
  'import type { Dialog } from "@/client/flow/dialog";',
  'import type Dialog from "@/client/flow/dialog";',
  'import { type Dialog, type Props } from "@/client/flow/dialog";',
  'export type { Dialog } from "@/client/flow/dialog";',
  'export type * from "@/client/flow/dialog";',
  'export { type Dialog } from "@/client/flow/dialog";',
  'import type Dialog = require("@/client/flow/dialog");',
]) {
  test(`${content} creates no runtime edge`, () => {
    assert.deepEqual(staticImportSpecifiers(content, entry), []);
    assertClean(analyze({ [entry]: content, [deferredPath]: "" }));
  });
}

for (const content of [
  'import { type Props, Dialog } from "@/client/flow/dialog";',
  'import Dialog, { type Props } from "@/client/flow/dialog";',
  'export { Dialog } from "@/client/flow/dialog";',
  'export * from "@/client/flow/dialog";',
  'export * as flow from "@/client/flow/dialog";',
  'import "@/client/flow/dialog";',
  'import {} from "@/client/flow/dialog";',
  'const Dialog = require("@/client/flow/dialog");',
  'function load() { return require("@/client/flow/dialog"); }',
  'class Flow extends require("@/client/flow/dialog") {}',
  'const Flow = class extends require("@/client/flow/dialog") {};',
  '(require)("@/client/flow/dialog");',
  '(require as NodeRequire)("@/client/flow/dialog");',
  '(require satisfies NodeRequire)("@/client/flow/dialog");',
  'require!("@/client/flow/dialog");',
  'require?.("@/client/flow/dialog");',
  'module.require("@/client/flow/dialog");',
  'module["require"]("@/client/flow/dialog");',
  '(module).require("@/client/flow/dialog");',
  'module?.require("@/client/flow/dialog");',
  '(module.require as NodeRequire)("@/client/flow/dialog");',
  'module["require"]("@/client/" + `flow/` + "dialog");',
  'module[("require")]("@/client/flow/dialog");',
  'module[`require`]("@/client/flow/dialog");',
  'module["re" + "quire"]("@/client/flow/dialog");',
  'require(("@/client/flow/dialog"));',
  'declare const require: <T>(p: string) => T; (require<string>)("@/client/flow/dialog"); export {};',
  '((require as NodeRequire)!)("@/client/flow/dialog");',
  'require(`@/client/flow/dialog`);',
  'require("@/client/" + "flow/" + "dialog");',
  'require("@/client/" + `flow/` + "dialog");',
  'require("" + "@/client/flow/dialog");',
  'import Dialog = require("@/client/flow/dialog");',
]) {
  test(`${content} creates a static edge`, () => {
    assert.deepEqual(staticImportSpecifiers(content, entry), ["@/client/flow/dialog"]);
    assert.equal(analyze({ [entry]: content, [deferredPath]: "" }).violations.length, 1);
  });
}

test("a type-asserted require callee in a .ts file creates a static edge", () => {
  const file = "apps/web/client/flow/trigger.ts";
  const content = '(<NodeRequire>require)("@/client/flow/dialog");';
  assert.deepEqual(staticImportSpecifiers(content, file), ["@/client/flow/dialog"]);
  assert.deepEqual(analyze({ [file]: content, [deferredPath]: "" }, { roots: [file] }).violations[0].chain, [file, deferredPath]);
});

test("the parser ignores comments, string contents and dynamic imports", () => {
  assert.deepEqual(staticImportSpecifiers(`
    // import "./comment";
    const text = 'require("./string")';
    const lazy = import("./dynamic");
    type Flow = import("./type-query").Flow;
    loader.require("./member");
  `, entry), []);
});

for (const content of [
  'require(name)',
  '(require)("./" + name)',
  'require(`./${name}`)',
  'require("./dialog" + 1)',
  'require()',
  'require("./dialog", "./other")',
  'module.require(name)',
  'module["require"](`./${name}`)',
  'module?.require()',
]) {
  test(`${content} fails closed with the file and unsupported expression`, () => {
    assert.throws(() => staticImportSpecifiers(content, entry), (error) => {
      assert.equal(error.message, `${entry}: unsupported require expression ${content}; use a statically evaluable string argument.`);
      return true;
    });
  });
}

for (const [content, expression] of [
  ['const r = require; r("./dialog");', 'require'],
  ['let r; r = require; r("./dialog");', 'r = require'],
  ['function f() { return require; }', 'require'],
  ['const a = require; const b = a; b("./dialog");', 'require'],
  ['require.call(null, "./dialog");', 'require.call(null, "./dialog")'],
  ['(0, require)("./dialog");', '(0, require)("./dialog")'],
  ['globalThis.require("./dialog");', 'globalThis.require("./dialog")'],
  ['window.require("./dialog");', 'window.require("./dialog")'],
  ['const r = module.require; r("./dialog");', 'module.require'],
  ['const r = module["require"]; r("./dialog");', 'module["require"]'],
  ['module.require;', 'module.require'],
  ['module["require"];', 'module["require"]'],
  ['module[("require")];', 'module[("require")]'],
  ['declare const require: <T>(p: string) => T; const load = require<string>; load("./dialog"); export {};', 'require'],
  ['require.resolve("./dialog");', 'require.resolve("./dialog")'],
  ['const { require: r } = module; r("./dialog");', 'require: r'],
  ['const x = { require };', 'require'],
  ['const { require } = module;', 'require'],
  ['class Flow extends require {}', 'require'],
  ['export { require };', 'require'],
  ['export { require as loader };', 'require'],
]) {
  test(`${content} rejects a require escape with the file and expression`, () => {
    assert.throws(() => staticImportSpecifiers(content, entry), (error) => {
      assert.equal(error.message, `${entry}: unsupported require expression ${expression}; use a statically evaluable string argument.`);
      return true;
    });
  });
}

for (const content of [
  'cdpCleanup.require();',
  'const x = { require: 1 };',
  'type T = typeof require;',
  'type T = typeof module.require;',
  'type require = number; export type { require };',
  'type require = number; export { type require };',
  'interface Flow extends NodeRequire<typeof require> {}',
]) {
  test(`${content} is not a require value reference`, () => {
    assert.deepEqual(staticImportSpecifiers(content, entry), []);
  });
}

for (const content of ['export { require } from "node:module";', 'export { loader as require } from "node:module";']) {
  test(`${content} keeps its static edge without rejecting a property name`, () => {
    assert.deepEqual(staticImportSpecifiers(content, entry), ["node:module"]);
  });
}

test("alias, relative, explicit extension and directory-index paths resolve", () => {
  const barrel = "apps/web/client/flow/index.ts";
  const helper = "apps/web/client/flow/helper.js";
  const result = analyze({
    [entry]: 'import "@/client/flow";',
    [barrel]: 'export * from "./helper.js";',
    [helper]: 'require("../flow/dialog");',
    [deferredPath]: "",
  });
  assert.deepEqual(result.violations[0].chain, [entry, barrel, helper, deferredPath]);
  assert.deepEqual(result.unresolved, []);
});

for (const extension of ["js", "mjs", "tsx", "ts", "jsx"]) {
  test(`extensionless and directory-index resolution support .${extension}`, () => {
    const helper = `apps/web/client/helper.${extension}`;
    const index = `apps/web/client/flow/index.${extension}`;
    const result = analyze({
      [entry]: 'import "@/client/helper";',
      [helper]: 'export * from "./flow";',
      [index]: 'import "./dialog";',
      [deferredPath]: "",
    });
    assert.deepEqual(result.violations[0].chain, [entry, helper, index, deferredPath]);
    assert.deepEqual(result.unresolved, []);
  });
}

for (const extension of ["mts", "cts", "cjs"]) {
  test(`an explicit .${extension} import resolves exactly and is walked`, () => {
    const helper = `apps/web/client/helper.${extension}`;
    const result = analyze({
      [entry]: `import "@/client/helper.${extension}";`,
      [helper]: 'import "@/client/flow/dialog";',
      [deferredPath]: "",
    });
    assert.deepEqual(result.violations[0].chain, [entry, helper, deferredPath]);
    assert.deepEqual(result.unresolved, []);
  });
}

test("every extensionless sibling candidate is walked", () => {
  const decoyTs = "apps/web/client/flow/dialog.ts";
  const decoyJs = "apps/web/client/flow/dialog.js";
  const tsDecoy = analyze({ [entry]: 'import "@/client/flow/dialog";', [decoyTs]: "", [deferredPath]: "" });
  assert.deepEqual(tsDecoy.violations.map(({ path }) => path), [deferredPath]);
  const jsDecoy = analyze({ [entry]: 'import "@/client/flow/dialog";', [decoyJs]: "", [deferredPath]: "" });
  assert.deepEqual(jsDecoy.violations.map(({ path }) => path), [deferredPath]);
  assert.deepEqual(jsDecoy.unresolved, []);
});

test("a bare dot or dotdot import resolves its directory index", () => {
  const index = "apps/web/app/(shell)/index.ts";
  const dot = analyze({ [entry]: 'import ".";', [index]: 'import "@/client/flow/dialog";', [deferredPath]: "" });
  assert.deepEqual(dot.violations.map(({ path }) => path), [deferredPath]);
  const parentIndex = "apps/web/app/index.ts";
  const dotdot = analyze({ [entry]: 'import "..";', [parentIndex]: 'import "@/client/flow/dialog";', [deferredPath]: "" });
  assert.deepEqual(dotdot.violations.map(({ path }) => path), [deferredPath]);
});

for (const helper of ["apps/web/client/flow/helper", "apps/web/client/flow/helper.txt"]) {
  test(`${helper} is parsed because webpack treats it as JavaScript`, () => {
    const specifier = helper.endsWith(".txt") ? "@/client/flow/helper.txt" : "@/client/flow/helper";
    const result = analyze({ [entry]: `import "${specifier}";`, [helper]: 'import "./dialog";', [deferredPath]: "" });
    assert.deepEqual(result.violations.map(({ path }) => path), [deferredPath]);
    assert.deepEqual(result.unresolved, []);
  });
}

for (const helper of ["apps/web/client/flow/helper.pdf", "apps/web/client/flow/helper.woff", "apps/web/client/flow/helper.wasm"]) {
  test(`${helper} is parsed because Next has no non-code loader for it`, () => {
    const specifier = `@/client/flow/helper.${helper.split(".").pop()}`;
    const result = analyze({ [entry]: `import "${specifier}";`, [helper]: 'import "./dialog";', [deferredPath]: "" });
    assert.deepEqual(result.violations.map(({ path }) => path), [deferredPath]);
    assert.deepEqual(result.unresolved, []);
  });
}

test("a directory package.json manifest fails closed", () => {
  const directory = "apps/web/client/flow";
  const files = {
    [entry]: 'import "@/client/flow";',
    [`${directory}/index.ts`]: "",
    [`${directory}/package.json`]: '{ "main": "../funding/add-money-dialog.tsx" }',
  };
  assert.throws(() => analyze(files), { message: `${directory}/package.json: directory manifests are not modeled by the shell deferral gate; import the file explicitly.` });
});

test("packages are external and resolved non-JS files are non-walkable leaves", () => {
  const css = "apps/web/app/(shell)/theme.css";
  const json = "apps/web/app/(shell)/data.json";
  const asset = "apps/web/app/(shell)/icon.svg";
  const result = analyze({
    [entry]: 'import "react"; import "@scope/package"; import "node:fs"; import "./theme.css"; import "./data.json"; import "./icon.svg";',
    [deferredPath]: "",
    [css]: "not JavaScript {{{",
    [json]: '{ "key": "value" }',
    [asset]: "<svg />",
  });
  assertClean(result);
  assert.deepEqual([...result.reachable], [entry, css, json, asset]);
});

test("unresolved local static imports fail closed with the importer and chain", () => {
  const importer = "apps/web/client/trigger.ts";
  const result = analyze({
    [entry]: 'import "@/client/trigger";',
    [importer]: 'import "./missing";',
    [deferredPath]: "",
  });
  assert.deepEqual(result.unresolved, [{ importer, specifier: "./missing", chain: [entry, importer] }]);
  assert.deepEqual(formatShellDeferredFindings(result), [
    `Unresolved static import: ${importer} imports "./missing"\n  Import chain: ${entry} -> ${importer}`,
  ]);
});

test("a missing listed deferred module is reported as a stale list entry", () => {
  const result = analyze({ [entry]: "" });
  assert.deepEqual(result.missingDeferred, [{ path: deferredPath, flow: "Test flow" }]);
  assert.deepEqual(formatShellDeferredFindings(result), [
    `Missing listed deferred module: ${deferredPath} (Test flow); update the stale defer list.`,
  ]);
});

test("a missing root and unparseable source cannot silently pass", () => {
  const result = analyze({ [deferredPath]: "" });
  assert.deepEqual(result.unresolved, [{ importer: null, specifier: entry, chain: [entry] }]);
  assert.throws(() => analyze({ [entry]: 'import {', [deferredPath]: "" }), /cannot parse static imports/);
});

test("BFS handles cycles and reports every reached deferred module once", () => {
  const second = { path: "apps/web/client/second.ts", flow: "Second flow" };
  const otherRoot = "apps/web/app/(shell)/home/page.tsx";
  const result = analyze({
    [entry]: 'import "@/client/flow/dialog";',
    [otherRoot]: 'import "@/client/second"; import "@/client/flow/dialog";',
    [deferredPath]: 'import "@/app/(shell)/layout";',
    [second.path]: "",
  }, { roots: [entry, otherRoot], deferred: [...deferred, second] });
  assert.deepEqual(result.violations.map(({ path: file, chain }) => ({ path: file, chain })), [
    { path: deferredPath, chain: [entry, deferredPath] },
    { path: second.path, chain: [otherRoot, second.path] },
  ]);
});

test("a symlinked module fails closed with its spelled import path", (t) => {
  const link = "apps/web/client/flow/link.tsx";
  const files = Object.fromEntries([...shellEntryRoots, ...deferredShellModules.map((module) => module.path)].map((file) => [file, ""]));
  files[entry] = 'import "@/client/flow/link";';
  files[deferredPath] = 'import "@/client/funding/add-money-dialog";';
  const root = fixtureRoot(t, files);
  symlinkSync("dialog.tsx", path.join(root, link));
  assert.throws(() => shellDeferredViolations({ root }), {
    message: `${link}: symlinked modules are not supported because module identity cannot be proven.`,
  });
});

test("a symlinked shell directory fails discovery and reachability closed", (t) => {
  const directory = "apps/web/app/(shell)/nested";
  const root = fixtureRoot(t, {
    "apps/web/app/(shell)/layout.tsx": "",
    "apps/web/client/flow/page.tsx": 'import "@/client/funding/add-money-dialog";',
  });
  symlinkSync("../../client/flow", path.join(root, directory));
  const expected = { message: `${directory}: symlinked shell entries are not supported because module identity cannot be proven.` };
  assert.throws(() => discoverShellEntryRoots(root), expected);
  assert.throws(() => shellDeferredViolations({ root }), expected);
});

test("a case-mismatched import fails closed instead of resolving", (t) => {
  const files = Object.fromEntries([...shellEntryRoots, ...deferredShellModules.map((module) => module.path)].map((file) => [file, ""]));
  files[entry] = 'import "./Dialog";';
  files["apps/web/app/(shell)/dialog.tsx"] = "";
  const result = shellDeferredViolations({ root: fixtureRoot(t, files) });
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.unresolved, [{ importer: entry, specifier: "./Dialog", chain: [entry] }]);
});

test("a case-mismatched ancestor directory fails closed", (t) => {
  const files = Object.fromEntries([...shellEntryRoots, ...deferredShellModules.map((module) => module.path)].map((file) => [file, ""]));
  files[entry] = 'import "./Dir/dialog";';
  files["apps/web/app/(shell)/dir/dialog.tsx"] = "";
  const result = shellDeferredViolations({ root: fixtureRoot(t, files) });
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.unresolved, [{ importer: entry, specifier: "./Dir/dialog", chain: [entry] }]);
});

test("a nested package.json fails closed", (t) => {
  const files = Object.fromEntries([...shellEntryRoots, ...deferredShellModules.map((module) => module.path)].map((file) => [file, ""]));
  files[entry] = 'import "@/client/funding/bridge/safe.js";';
  files["apps/web/client/funding/bridge/safe.js"] = "";
  files["apps/web/client/funding/bridge/package.json"] = '{ "browser": "../add-money-dialog.tsx" }';
  assert.throws(() => shellDeferredViolations({ root: fixtureRoot(t, files) }), { message: "apps/web/client/funding/bridge/safe.js: the nested package at apps/web/client/funding/bridge is not modeled by the shell deferral gate; remove its package.json or import the file explicitly." });
});

test("an inline loader request fails closed before external classification", () => {
  assert.throws(() => analyze({ [entry]: 'import "!!@/client/helper.js";' }), { message: `${entry}: inline loader request "!!@/client/helper.js" is not modeled by the shell deferral gate.` });
});

test("an imports-map specifier fails closed before external classification", () => {
  assert.throws(() => analyze({ [entry]: 'import "#helper";' }), { message: `${entry}: the "#helper" imports-map specifier is not modeled by the shell deferral gate.` });
});

test("an unmodeled tsconfig path alias fails closed", (t) => {
  const root = fixtureRoot(t, { "apps/web/tsconfig.json": '{ "compilerOptions": { "paths": { "@/*": ["./*"], "~/*": ["./*"] } } }' });
  assert.throws(() => shellDeferredViolations({ root }), { message: 'apps/web/tsconfig.json declares the path alias "~/*" with targets ["./*"]; the shell deferral gate models only "@/*" -> ["./*"].' });
});

test("an app package browser or imports field fails closed", (t) => {
  for (const field of ["browser", "imports"]) {
    const root = fixtureRoot(t, { "apps/web/package.json": `{ "${field}": {} }` });
    assert.throws(() => shellDeferredViolations({ root }), { message: `apps/web/package.json declares "${field}", a resolution feature the shell deferral gate does not model.` });
  }
});

test("an AMD define call fails closed", () => {
  assert.throws(() => analyze({ [entry]: 'define(["./dialog"], function () {});' }), { message: `${entry}: AMD define(...) is not modeled by the shell deferral gate.` });
});

test("a webpack context call fails closed", () => {
  assert.throws(() => analyze({ [entry]: 'require.context("./flow", false, /dialog/);' }), { message: `${entry}: require.context is not modeled by the shell deferral gate.` });
  assert.throws(() => analyze({ [entry]: 'import.meta.webpackContext("./flow", { mode: "sync" });' }), { message: `${entry}: import.meta.webpackContext is not modeled by the shell deferral gate.` });
  assert.throws(() => analyze({ [entry]: 'import.meta["webpackContext"]("./flow", { mode: "sync" });' }), { message: `${entry}: import.meta.webpackContext is not modeled by the shell deferral gate.` });
  assert.throws(() => analyze({ [entry]: '(import.meta).webpackContext("./flow", { mode: "sync" });' }), { message: `${entry}: import.meta.webpackContext is not modeled by the shell deferral gate.` });
});

test("a resource query or fragment fails closed before resolution", () => {
  assert.throws(() => analyze({ [entry]: 'import "./dialog?raw";' }), { message: `${entry}: the resource query in "./dialog?raw" is not modeled by the shell deferral gate.` });
  assert.throws(() => analyze({ [entry]: 'import "./dialog#fragment";' }), { message: `${entry}: the fragment in "./dialog#fragment" is not modeled by the shell deferral gate.` });
});

test("a URL-scheme specifier fails closed before external classification", () => {
  assert.throws(() => analyze({ [entry]: 'import "data:text/javascript,export * from \'@/client/flow/dialog\';";' }), { message: `${entry}: the URL-scheme specifier "data:text/javascript,export * from '@/client/flow/dialog';" is not modeled by the shell deferral gate.` });
});

test("a webpack magic comment on import() fails closed", () => {
  assert.throws(() => analyze({ [entry]: 'import("./dialog" /* webpackMode: "eager" */);' }), { message: `${entry}: a webpack magic comment on import() is not modeled by the shell deferral gate.` });
  assert.throws(() => analyze({ [entry]: 'import((/* webpackMode: "eager" */ "./dialog"));' }), { message: `${entry}: a webpack magic comment on import() is not modeled by the shell deferral gate.` });
});

test("a server-relative request fails closed", () => {
  assert.throws(() => analyze({ [entry]: 'import "/client/funding/add-money-dialog";' }), { message: `${entry}: the "/client/funding/add-money-dialog" server-relative request is not modeled by the shell deferral gate.` });
});

test("a root manifest resolution field fails closed", (t) => {
  const root = fixtureRoot(t, { "package.json": '{ "exports": {} }' });
  assert.throws(() => shellDeferredViolations({ root }), { message: 'package.json declares "exports", a resolution feature the shell deferral gate does not model.' });
});

test("a tsconfig baseUrl or remapped alias value fails closed", (t) => {
  const baseUrl = fixtureRoot(t, { "apps/web/tsconfig.json": '{ "compilerOptions": { "baseUrl": "." } }' });
  assert.throws(() => shellDeferredViolations({ root: baseUrl }), { message: 'apps/web/tsconfig.json declares "baseUrl", a resolution feature the shell deferral gate does not model.' });
  const remapped = fixtureRoot(t, { "apps/web/tsconfig.json": '{ "compilerOptions": { "paths": { "@/*": ["./bridge/*"] } } }' });
  assert.throws(() => shellDeferredViolations({ root: remapped }), { message: 'apps/web/tsconfig.json declares the path alias "@/*" with targets ["./bridge/*"]; the shell deferral gate models only "@/*" -> ["./*"].' });
  const extended = fixtureRoot(t, { "apps/web/tsconfig.json": '{ "extends": "./tsconfig.base.json" }' });
  assert.throws(() => shellDeferredViolations({ root: extended }), { message: 'apps/web/tsconfig.json declares "extends", a resolution inheritance the shell deferral gate does not model.' });
  for (const compilerOptions of ['{ "moduleSuffixes": [".native", ""] }', '{ "jsxImportSource": "./jsx-runtime" }']) {
    const options = fixtureRoot(t, { "apps/web/tsconfig.json": `{ "compilerOptions": ${compilerOptions} }` });
    assert.throws(() => shellDeferredViolations({ root: options }), /does not model/);
  }
  const babel = fixtureRoot(t, { "apps/web/.babelrc": '{ "plugins": ["./rewrite-imports"] }' });
  assert.throws(() => shellDeferredViolations({ root: babel }), { message: "apps/web/.babelrc changes import transforms the shell deferral gate does not model." });
});

test("a next.config resolver override fails closed", (t) => {
  const root = fixtureRoot(t, { "apps/web/next.config.ts": 'export default { turbopack: { resolveAlias: { probe: "./client/funding/add-money-dialog.tsx" } } };' });
  assert.throws(() => shellDeferredViolations({ root }), { message: "apps/web/next.config.ts declares a resolver or import transform the shell deferral gate does not model." });
  assert.throws(() => shellDeferredViolations({ root: fixtureRoot(t, { "apps/web/next.config.mjs": 'export { default } from "./build-config.mjs";' }) }), { message: "apps/web/next.config.mjs loads another module at runtime; the shell deferral gate models only a self-contained config." });
  assert.throws(() => shellDeferredViolations({ root: fixtureRoot(t, { "apps/web/next.config.js": 'const load = require /* comment */ ("./build-config.cjs"); export default { load };' }) }), { message: "apps/web/next.config.js loads another module at runtime; the shell deferral gate models only a self-contained config." });
  assert.throws(() => shellDeferredViolations({ root: fixtureRoot(t, { "apps/web/next.config.js": 'const key = "web" + "pack"; export default { [key](config) { return config; } };' }) }), { message: "apps/web/next.config.js uses a computed configuration key; the shell deferral gate models only literal configuration." });
  assert.throws(() => shellDeferredViolations({ root: fixtureRoot(t, { "apps/web/next.config.js": 'export default { pageExtensions: ["mjs"] };' }) }), { message: "apps/web/next.config.js declares a resolver or import transform the shell deferral gate does not model." });
  for (const source of ['export default { "tu\\u0072bopack": {} };', 'export default { compiler: { relay: {} } };']) {
    assert.throws(() => shellDeferredViolations({ root: fixtureRoot(t, { "apps/web/next.config.js": source }) }), { message: "apps/web/next.config.js declares a resolver or import transform the shell deferral gate does not model." });
  }
  for (const source of ['const key = "tur" + "bopack"; export default Object.fromEntries([[key, {}]]);', 'export default Object.assign({}, module.require("./build-config.cjs"));', 'const key = "tur" + "bopack"; export default Object["fromEntries"]([[key, {}]]);', 'export default (Object).fromEntries([]);']) {
    assert.throws(() => shellDeferredViolations({ root: fixtureRoot(t, { "apps/web/next.config.js": source }) }), { message: "apps/web/next.config.js constructs configuration dynamically; the shell deferral gate models only a literal configuration object." });
  }
  for (const source of ['export default { webpack(config) { return config; } };', 'export default { typescript: { tsconfigPath: "tsconfig.build.json" } };', 'export default { experimental: { turbo: {} } };', 'export default { "pageExtensions": ["mjs"] };']) {
    const config = fixtureRoot(t, { "apps/web/next.config.ts": source });
    assert.throws(() => shellDeferredViolations({ root: config }), { message: "apps/web/next.config.ts declares a resolver or import transform the shell deferral gate does not model." });
  }
});

test("a non-default jsxImportSource pragma fails closed", () => {
  assert.throws(() => analyze({ [entry]: '/** @jsxImportSource ./jsx-runtime */\nexport default function Page() { return null; }' }), { message: `${entry}: the @jsxImportSource pragma ./jsx-runtime is not modeled by the shell deferral gate.` });
  assert.deepEqual(staticImportSpecifiers('/** @jsxImportSource react */\nexport default null;', entry), []);
  for (const source of ['/** @jsxImportSource react */\n/** @jsxImportSource ./jsx-runtime */\nexport default null;', 'const s = "@jsxImportSource react ";\n/** @jsxImportSource ./jsx-runtime */\nexport default null;']) {
    assert.throws(() => analyze({ [entry]: source }), { message: `${entry}: the @jsxImportSource pragma ./jsx-runtime is not modeled by the shell deferral gate.` });
  }
});

test("an uppercase image extension is a non-code leaf like Next", () => {
  const icon = "apps/web/app/(shell)/icon.PNG";
  const result = analyze({ [entry]: 'import "./icon.PNG";', [icon]: "PNG {{{ binary", [deferredPath]: "" });
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.unresolved, []);
  assert.deepEqual([...result.reachable], [entry, icon]);
});

test("the real authenticated shell stays deferred and resolves every static import and entry", () => {
  assertClean(shellDeferredViolations());
});

test("discovery includes all 14 listed shell entry roots", () => {
  const entries = discoverShellEntryRoots(repoRoot);
  assert.equal(shellEntryRoots.length, 14);
  assert.deepEqual(shellEntryRoots.slice(0, 4), [
    "apps/web/app/layout.tsx", "apps/web/app/error.tsx", "apps/web/app/global-error.tsx", "apps/web/instrumentation-client.ts",
  ]);
  for (const file of shellEntryRoots) assert.ok(entries.includes(file), `Discover ${file}`);
});

test("discovery covers JS-family conventions and nested shell entries but not the landing route", (t) => {
  const expected = [];
  for (const extension of ["ts", "tsx", "js", "jsx"]) {
    for (const name of ["layout", "template", "default", "loading", "error", "global-error", "not-found", "forbidden", "unauthorized"]) {
      expected.push(`apps/web/app/${name}.${extension}`);
    }
    for (const name of ["page", "layout", "template", "default", "route", "loading", "error", "global-error", "not-found", "forbidden", "unauthorized"]) {
      expected.push(`apps/web/app/(shell)/nested/${name}.${extension}`);
    }
    expected.push(`apps/web/instrumentation-client.${extension}`);
  }
  const excluded = [
    "apps/web/app/page.tsx", "apps/web/app/route.ts",
    "apps/web/app/(landing)/layout.tsx", "apps/web/app/(shell)/helper.tsx",
    "apps/web/app/(shell)/page.mjs", "apps/web/instrumentation.ts",
  ];
  const root = fixtureRoot(t, Object.fromEntries([...expected, ...excluded].map((file) => [file, ""])));
  assert.deepEqual(discoverShellEntryRoots(root).sort(), expected.sort());
});

test("discovery tolerates absent convention directories", (t) => {
  assert.deepEqual(discoverShellEntryRoots(fixtureRoot(t, {})), []);
});

for (const rootEntry of ["apps/web/app/layout.tsx", "apps/web/app/loading.tsx", "apps/web/app/default.tsx", "apps/web/app/(shell)/loading.tsx"]) {
  test(`${rootEntry} is walked even when discovered but unlisted`, (t) => {
    const files = Object.fromEntries([...shellEntryRoots, ...deferredShellModules.map((module) => module.path)].map((file) => [file, ""]));
    files[rootEntry] = 'import "@/client/funding/add-money-dialog";';
    const result = shellDeferredViolations({ root: fixtureRoot(t, files) });
    const module = deferredShellModules.find((module) => module.flow === "Add money");
    assert.deepEqual(result.violations, [{
      ...module, chain: [rootEntry, module.path], importer: rootEntry, specifier: "@/client/funding/add-money-dialog",
    }]);
    assert.deepEqual(result.unresolved, []);
    assert.deepEqual(result.missingDeferred, []);
    const unlisted = shellEntryRoots.includes(rootEntry) ? [] : [rootEntry];
    assert.deepEqual(result.unlistedRoots, unlisted);
    const findings = formatShellDeferredFindings(result);
    assert.ok(findings[0].includes(`Import chain: ${rootEntry} -> ${module.path}`));
    if (unlisted.length) assert.equal(findings[1], `${rootEntry} is a shell entry file not listed in shellEntryRoots; add it so the walk covers it.`);
  });
}

test("the CLI passes the real repository with no findings", () => {
  const result = spawnSync(process.execPath, [cli], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /^Shell flows stay deferred: 14 entry roots, \d+ reachable files, 0 violations\.\n$/);
});
