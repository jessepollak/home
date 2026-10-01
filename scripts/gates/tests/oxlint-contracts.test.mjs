import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { evaluateBoundaryExemptions, rootSourceFiles, topLevelSourceDirectories } from "../exploration-boundary.mjs";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const appsWebDir = path.join(repoRoot, "apps/web");
const mirror = await mkdtemp(path.join(tmpdir(), "home-oxlint-contracts-"));
after(() => rm(mirror, { recursive: true, force: true }));

async function assertTreeEqual(source, destination, label) {
  if ((await stat(source)).isDirectory()) {
    const entries = await readdir(source);
    assert.deepEqual(entries, await readdir(destination), `${label} tree must match`);
    for (const entry of entries) await assertTreeEqual(path.join(source, entry), path.join(destination, entry), `${label}/${entry}`);
  } else {
    assert.deepEqual(await readFile(destination), await readFile(source), `${label} must be copied byte-for-byte`);
  }
}

async function mirrorFile(relativePath) {
  const source = path.join(appsWebDir, relativePath);
  const destination = path.join(mirror, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true });
  await assertTreeEqual(source, destination, relativePath);
}

await mirrorFile(".oxlintrc.jsonc");
await mirrorFile("oxlint");
await mkdir(path.join(mirror, "node_modules"));
for (const entry of await readdir(path.join(appsWebDir, "node_modules"))) {
  if (entry === "ignored.ts") continue;
  await symlink(path.join(appsWebDir, "node_modules", entry), path.join(mirror, "node_modules", entry));
}
await symlink(path.join(appsWebDir, "components.json"), path.join(mirror, "components.json"));
await symlink(path.join(appsWebDir, "tsconfig.json"), path.join(mirror, "tsconfig.json"));
await mkdir(path.join(mirror, "app"), { recursive: true });
await symlink(path.join(appsWebDir, "app/globals.css"), path.join(mirror, "app/globals.css"));
await mkdir(path.join(mirror, "components/ui"), { recursive: true });
await symlink(path.join(appsWebDir, "components/ui/button.tsx"), path.join(mirror, "components/ui/button.tsx"));

const paths = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "apps/web"], { cwd: repoRoot })
  .toString().split("\0").filter((entry) => existsSync(path.join(repoRoot, entry)))
  .map((entry) => entry.slice("apps/web/".length));
const directories = topLevelSourceDirectories(paths);
const rootFiles = rootSourceFiles(paths);
const exemptions = JSON.parse(await readFile(new URL("../exploration-boundary-exemptions.json", import.meta.url), "utf8"));
const boundary = evaluateBoundaryExemptions({ directories, rootFiles, exemptions });

const fixtures = {
  "app/comment.mjs": "export const value = 1; // unexplained",
  "client/comment.ts": "export const value = 1; /* narrative */",
  "components/comment.jsx": "export const value = 1; // narrative",
  "server/comment.ts": "import \"server-only\"; export const value = 1; // narrative",
  "shared/comment.tsx": "export const value = 1; /* narrative */",
  "shared/comment-clean.ts": ["/** @public Shared contract for external consumers. */", "export const value = 1;"].join(String.fromCharCode(10)),
  "client/comment-clean.test.ts": ["// test code is excluded", "export const value = 1;"].join(String.fromCharCode(10)),
  "client/comment-clean.stories.tsx": ["// story code is excluded", "export const value = 1;"].join(String.fromCharCode(10)),
  "stories/explorations/untagged.stories.tsx": 'const meta = { id: "missing-tag" }; export default meta;',
  "client/explorations/untagged.stories.tsx": 'export default { id: "missing-tag" };',
  "components/explorations/tagged.stories.tsx": 'const meta = { id: "tagged", tags: ["exploration"] }; export default meta;',
  "stories/journeys/ordinary.stories.tsx": 'const meta = { id: "ordinary" }; export default meta;',
  "client/storybook.tsx": 'import x from "@storybook/test"; export { x }; export * from "msw"; const a = import(`storybook`); const b = require("msw/browser"); export { a, b };',
  "components/barrel.ts": 'export * from "./explorations/ledger"; export { Row } from "@/client/explorations/row"; import x from "../client/explorations/x"; const a = import(`@/components/explorations/a`); const b = require("./explorations/b"); export { x, a, b };',
  "client/exploration-template.ts": 'const a = import(`./explorations/${name}`); const b = require(`@/client/explorations/${name}`); void a; void b;',
  "client/exploration-template-clean.ts": 'const a = import(`${kind}/row`); void a;',
  "client/exploration-assertions.ts": 'const a = import("./explorations/foo" as unknown as string); const b = import("./explorations/foo" satisfies string); const c = require(("./explorations/bar"!)); void a; void b; void c;',
  "client/exploration-angle-assertion.ts": 'const x = import(<string>"./explorations/row"); void x;',
  "proxy.ts": 'import "./client/explorations/probe"; import helper from "./tests/helpers/helper"; export { helper };',
  "proxy.js": 'import "./client/explorations/probe";',
  "instrumentation.js": 'import "./client/explorations/probe";',
  "next.config.mjs": 'import "./client/explorations/probe";',
  "client/exploration-concatenated.ts": 'const a = import("./explorations/" + "x"); const b = require("@/client/" + "explorations/x"); const c = import(`./explorations/${name}`); void a; void b; void c;',
  "client/exploration-concatenated-dynamic.ts": 'const a = import("./explorations/" + name); const b = require("@/client/explorations/" + name); const c = import(name + "/explorations/row"); const d = require(name + "/explorations/row"); void a; void b; void c; void d;',
  "client/exploration-concatenated-clean.ts": 'const a = import(dir + "/row"); const b = import("./explor" + "ationNotes"); const c = import(`${kind}/row`); const d = import("./explor" + name); void a; void b; void c; void d;',
  "client/exploration-split-template.ts": 'const a = import(`./explor${"ations"}/${name}`); const b = import(`./x/${name}/explorations/${thing}`); const c = import(`./explor${"ationNotes"}/${name}`); void a; void b; void c;',
  "client/exploration-cross-boundary.ts": 'const a = import("./explor" + `ations/${name}`); const b = import(`./${`explorations/${name}`}`); void a; void b;',
  "client/exploration-cross-boundary-clean.ts": 'const a = import("./explor" + `ationNotes/${name}`); void a;',
  "client/exploration-conditional.ts": 'const a = import(flag ? "./explorations/a" : "./live"); const b = require(value || "./explorations/a"); void a; void b;',
  "client/exploration-conditional-clean.ts": 'const a = import(flag ? "./live" : "./other"); const b = require(value || "./other"); void a; void b;',
  "client/exploration-conditional-concat.ts": 'const a = import("./explor" + (flag ? "ations/a" : "ationNotes/a")); void a;',
  "client/exploration-unknown-segment-clean.ts": 'const suffix = flag ? "x" : "y"; const a = import("./explor" + suffix + "ations/row"); void a;',
  "client/exploration-overflow.ts": 'const a = import("./explorations/" + (f1 ? "" : "") + (f2 ? "" : "") + (f3 ? "" : "") + (f4 ? "" : "") + (f5 ? "" : "") + (f6 ? "" : "") + (f7 ? "" : "")); void a;',
  "client/exploration-overflow-merge.ts": 'const a = import("./explo" + (f1 ? "" : g1) + (f2 ? "" : g2) + (f3 ? "" : g3) + (f4 ? "" : g4) + (f5 ? "" : g5) + (f6 ? "" : g6) + (f7 ? "" : g7) + "rations/row"); void a;',
  "client/exploration-mutually-exclusive-clean.ts": 'const a = import("./" + (flag ? "explor" : "ations") + (f1 ? "" : "") + (f2 ? "" : "") + (f3 ? "" : "") + (f4 ? "" : "") + (f5 ? "" : "") + (f6 ? "" : "") + (f7 ? "" : "") + "/row"); void a;',
  "client/exploration-fixture.stories.fixture.ts": 'import { Row } from "./explorations/row"; export { Row };',
  "app/exploration-leak.ts": 'export { Row } from "@/app/explorations/row";',
  "server/exploration-leak.ts": 'import "server-only"; export * from "./explorations/ledger";',
  "shared/exploration-leak.ts": 'export * from "./explorations/ledger";',
  "client/explorations/inside.ts": 'import row from "@/client/explorations/row"; export { row };',
  "client/explorations/nested.ts": 'import row from "../explorations/row"; export { row };',
  "client/exploration-import.stories.tsx": 'import row from "./explorations/row"; export { row };',
  "client/exploration-import.test.ts": 'import row from "./explorations/row"; export { row };',
  "client/exploration-names.ts": 'import notes from "@/client/exploration-notes"; import helper from "./explorationsHelper"; export { notes, helper };',
  "client/exploration-type-query.ts": 'export type Row = typeof import("./explorations/row").Row; export type Ledger = import("@/client/explorations/ledger").Ledger;',
  "client/test-support-relative.ts": 'import helper from "./testing/helper"; export { helper };',
  "client/test-support-alias.ts": 'export { helper } from "@/tests/helpers/helper";',
  "client/test-support-dynamic.ts": 'const a = import("@/tests/helpers/helper"); const b = require("../tests/helpers/helper"); const c = import(`@/tests/helpers/${name}`); void a; void b; void c;',
  "client/test-support-type-query.ts": 'export type Helper = typeof import("@/tests/helpers/helper").helper;',
  "client/test-support-modules.ts": 'import helper from "./helper.test"; export { other } from "@/client/helper.test.ts"; export { helper };',
  "server/test-support-relative.ts": 'import "server-only"; import { describeFundingAdapter } from "../core/testing/describeFundingAdapter"; export { describeFundingAdapter };',
  "client/testing/barrel.ts": 'export * from "../explorations/row";',
  "client/barrel-consumer.ts": 'export * from "./testing/barrel";',
  "client/test-support-import.test.ts": 'import helper from "@/tests/helpers/helper"; export { helper };',
  "client/test-support-import.stories.tsx": 'import helper from "@/tests/helpers/helper"; export { helper };',
  "tests/helpers/test-support-import.ts": 'import helper from "@/tests/helpers/helper"; export { helper };',
  "client/test-support-names.ts": 'import notes from "./testing-notes"; import helper from "@/client/test-harness-notes"; export { notes, helper };',
  "client/test-support-package.ts": 'import { render } from "@testing-library/react"; export { render };',
  "client/account/dom-test-harness.ts": 'import helper from "@/tests/helpers/helper"; export { helper };',
  "scripts/device-profile/proxy.ts": 'import helper from "../../tests/helpers/helper"; export { helper };',
  "client/test-support-windows.ts": 'export type Helper = import("..\\\\tests\\\\helper").Helper;',
  "client/test-support-alias-traversal-clean.ts": 'export * from "@/tests/../client/live";',
  "client/test-support-relative-traversal-clean.ts": 'export * from "../tests/../client/live";',
  "client/test-support-harness-consumer.ts": 'export * from "./probe-test-harness";',
  "client/probe-test-harness.ts": 'export * from "../tests/helper"; export * from "./explorations/row";',
  "client/test-support-fragment-traversal.ts": 'const a = import(`./testing/..${suffix}/barrel`); const b = import("./testing/.." + suffix + "/barrel"); void a; void b;',
  "client/test-support-overflow-late-branch.ts": 'const a = import("./" + (choose ? (f1 ? "" : "") + (f2 ? "" : "") + (f3 ? "" : "") + (f4 ? "" : "") + (f5 ? "" : "") + (f6 ? "" : "") + (f7 ? "" : "") + (f8 ? "" : "") + (f9 ? "" : "") + (f10 ? "" : "") + (f11 ? "" : "") + (f12 ? "" : "") : (bad ? "safe" : "tests/helper"))); void a;',
  "client/test-support-overflow-joined-split.ts": 'const a = import("./te" + (choose ? (f1 ? "" : "") + (f2 ? "" : "") + (f3 ? "" : "") + (f4 ? "" : "") + (f5 ? "" : "") + (f6 ? "" : "") + (f7 ? "" : "") + (f8 ? "" : "") + (f9 ? "" : "") + (f10 ? "" : "") + (f11 ? "" : "") + (f12 ? "" : "") : (bad ? "safe" : "sts/helper"))); void a;',
  "client/test-support-overflow-prefix-clean.ts": 'const a = import("./prefix-" + (choose ? (f1 ? "" : "") + (f2 ? "" : "") + (f3 ? "" : "") + (f4 ? "" : "") + (f5 ? "" : "") + (f6 ? "" : "") + (f7 ? "" : "") + (f8 ? "" : "") + (f9 ? "" : "") + (f10 ? "" : "") + (f11 ? "" : "") + (f12 ? "" : "") : (bad ? "safe" : "tests/helper"))); void a;',
  "client/test-support-overflow-distinct-late-branch.ts": 'const a = import("./" + (choose ? (g1 ? "a/" : "b/") + (g2 ? "a/" : "b/") + (g3 ? "a/" : "b/") + (g4 ? "a/" : "b/") + (g5 ? "a/" : "b/") + (g6 ? "a/" : "b/") + (g7 ? "a/" : "b/") + (g8 ? "a/" : "b/") + (g9 ? "a/" : "b/") + (g10 ? "a/" : "b/") + (g11 ? "a/" : "b/") + (g12 ? "a/" : "b/") + (g13 ? "a/" : "b/") : (bad ? "safe" : "tests/helper"))); void a;',
  "client/test-support-complete-traversal-clean.ts": 'export { value } from "./testing/..";',
  "client/test-support-alias-complete-traversal-clean.ts": 'export { value } from "@/tests/..";',
  "types/helper.test.d.ts": 'import type { Helper } from "@/tests/helpers/helper"; export type H = Helper;',
  "client/test-support-declaration.ts": 'import type { Helper } from "@/types/helper.test.d"; export type H = Helper;',
  "types/probe-test-harness.d.ts": 'import type { Helper } from "@/tests/helpers/helper"; export type H = Helper;',
  "client/harness-declaration-consumer.ts": 'import type { H } from "@/types/probe-test-harness.d"; export type C = H;',
  "config/exploration-jsdoc.js": ['/** @type {import("@/client/explorations/row").Row} */', "export const probe = null;"].join(String.fromCharCode(10)),
  "config/exploration-jsdoc-import.js": ['/** @import { Row } from "@/client/explorations/row" */', "export const probe = null;"].join(String.fromCharCode(10)),
  "config/exploration-jsdoc-braceless.js": ['/** @type import("@/client/explorations/row").Row */', "export const probe = null;"].join(String.fromCharCode(10)),
  "config/exploration-jsdoc-escaped.js": ['/** @type {import("@/client/\\u0065xplorations/row").Row} */', "export const probe = null;"].join(String.fromCharCode(10)),
  "config/exploration-jsdoc-inline.js": ['/** @deprecated @import { Row } from "@/client/explorations/row" */', "export const probe = null;"].join(String.fromCharCode(10)),
  "config/exploration-jsdoc-prose-quote.js": ['/** An "example', ' * @type {import("@/client/explorations/row").T}', " */", "export const probe = null;"].join(String.fromCharCode(10)),
  "config/exploration-jsdoc-unterminated.js": ['/** @type {import("@/client/explorations/row").Row */', "export const probe = null;"].join(String.fromCharCode(10)),
  "config/exploration-jsdoc-wrapped.js": ["/** @type {import(", ' * "@/client/explorations/row"', " * ).Row} */", "export const probe = null;"].join(String.fromCharCode(10)),
  "config/exploration-jsdoc-import-edge.js": ['/** @import {Row}from "@/client/explorations/row" */', 'const first = null; void first;', '/** @import {Row}"@/client/explorations/row" */', "export const probe = null;"].join(String.fromCharCode(10)),
  "config/exploration-jsdoc-typescript.ts": ['/** @type {import("@/client/explorations/row").Row} */', "export const probe = null;"].join(String.fromCharCode(10)),
  "config/exploration-jsdoc-clean.js": ['/** @type {import("@/lib/utils").Cn} Prose with {"a": 1}. */', "export const first = null;", '/** @type {import("@/client/exploration-notes").Row} */', "export const probe = null;"].join(String.fromCharCode(10)),
  "config/exploration-jsdoc-prose-clean.js": ['/** @public Example {import("@/client/explorations/row").T}. */', "export const example = null;", "/** @type {string} Description import('@/client/explorations/row').Row. */", "export const description = null;", '/** @type {"import(\'@/client/explorations/row\')"} */', "export const literal = null;", "/** @type {import(`@/client/explorations/row`).Row} */", "export const template = null;", "/** @type {import(`@/client/explorations/${name}`).Row} */", "export const interpolated = null;", '/* @type {import("@/client/explorations/row").Row} */', "export const block = null;", '// @type {import("@/client/explorations/row").Row}', "export const line = null;", "/** @type {", ' * import("@/client/explorations/row").Row', " * } */", "export const multiline = null;"].join(String.fromCharCode(10)),
  "client/explorations/jsdoc.js": ['/** @type {import("@/client/explorations/row").Row} */', "export const probe = null;"].join(String.fromCharCode(10)),
  "config/exploration-jsdoc-no-tags.js": ['/** Untagged documentation prose. */'.repeat(200), "export const probe = null;"].join(String.fromCharCode(10)),
  "config/storybook.ts": 'export { setupWorker } from "msw/browser";',
  "types/storybook.d.ts": 'import type { Meta } from "@storybook/nextjs-vite"; export type M = Meta;',
  "client/layers.ts": 'import a from "@/server/a"; export { b } from "../server/b"; const c = import(`@/server/c`); const d = require(`../server/d`); export { a, c, d };',
  "server/layers.ts": 'import "server-only"; import a from "@/client/a"; const b = import(`../components/b`); const c = require("@/app/c"); export { a, b, c };',
  "shared/layers.ts": 'import React from "react"; export * from "node:fs"; const a = import(`@/client/a`); const b = require("../server/b"); export { React, a, b };',
  "client/classic-zod.ts": 'import * as a from "zod"; import * as b from "zod/v4"; import * as c from "zod/v3"; export { a, b, c };',
  "components/classic-zod.ts": 'export { z } from "zod/v4/core"; export * from "zod/v4-mini";',
  "shared/classic-zod.ts": 'const a = import("zod/v4"); const b = import(`zod/v3`); const c = require("zod"); const d = require(`zod/v4/core`); export { a, b, c, d };',
  "shared/mini-zod.ts": 'import * as z from "zod/mini"; export const value = z.string();',
  "server/classic-zod.ts": 'import "server-only"; import * as z from "zod"; export const value = z.string();',
  "app/sdk.ts": 'import x from "@coinbase/cdp-hooks/subpath"; export { x };',
  "client/sdk.ts": 'import x from "@base-org/account/subpath"; export { x };',
  "components/sdk.ts": 'import x from "@coinbase/cdp-hooks"; export { x };',
  "shared/sdk.ts": 'import x from "@coinbase/cdp-core"; export { x };',
  "client/account/sdk.tsx": 'import type { ProviderInterface } from "@coinbase/cdp-hooks"; export type P = ProviderInterface;',
  "app/base-ui.tsx": 'import x from "@base-ui/react/button"; export { x };',
  "client/base-ui.tsx": 'import x from "@base-ui/react"; export { x };',
  "components/base-ui.tsx": 'import x from "@base-ui/react"; export { x };',
  "server/base-ui.ts": 'import "server-only"; import x from "@base-ui/react"; export { x };',
  "shared/base-ui.ts": 'import x from "@base-ui/react"; export { x };',
  "server/no-marker.ts": 'export const x = 1;',
  "server/instrumentation-unsafe.ts": 'import "server-only"; import { sendHomeStartupReport } from "@/client/observability/perf-marks"; sendHomeStartupReport(report);',
  "server/instrumentation-safe.ts": 'import "server-only"; import { emitServerEvent } from "@/server/observability/log"; emitServerEvent("kind", fields);',
  "server/late-marker.ts": 'import x from "x"; import "server-only"; export { x };',
  "server/clean.ts": 'import "server-only"; export const x = 1;',
  "client/format.tsx": 'export const a = new Intl.NumberFormat(); export const b = new Intl.DateTimeFormat(); export const c = (x: number) => x.toLocaleString(); export const d = (x: Date) => x.toLocaleDateString(); export const e = (x: Date) => x.toLocaleTimeString(); export const f = (x: number) => x.toFixed(2);',
  "shared/formatting/clean.ts": 'export const f = (x: number) => x.toFixed(2);',
  "shared/formatting/amount-fallback.ts": 'export const a=amount??0; export const b=Number(total)||0; export const c=parseFloat(fiatValue)||0;',
  "shared/formatting/amount-fallback-clean.ts": 'export const a=amount??null; export const b=retryCount??0;',
  "client/styles.tsx": 'import { cn } from "@/lib/utils"; export function A(){ return <><div className="bg-[#123456]"/><div className={"text-blue-500"}/><div className={`p-[7px]`}/><div className={cn("rgba(0,0,0,.5)")}/></> }',
  "client/styles-clean.tsx": 'export function A(){ return <div className="w-[var(--gate-width)] p-4 text-sm"/> }',
  "client/has-policy.tsx": 'export function A(){ return <div className="has-[input]:p-0"/> }',
  "client/root-has-policy.tsx": 'export function A(){ return <div className="[html:not(.x):has(>main)_&]:p-0"/> }',
  "client/root-case-policy.tsx": 'export function A(){ return <div className="[:ROOT:has(>main)_&]:p-0"/> }',
  "client/important-policy.tsx": 'export function A(){ return <div className="p-4!"/> }',
  "client/important-policy.stories.tsx": 'export function A(){ return <div className="p-4!"/> }',
  "stories/important-policy.tsx": 'export function A(){ return <div className="p-4!"/> }',
  "app/raw.tsx": 'export function A(){ return <><button>go</button><input/><select/></> }',
  "app/silent-catch.ts": 'try { run(); } catch {}',
  "app/handled-catch.ts": 'declare function run(): unknown; export function read(){ try { return run(); } catch { return { ok: false }; } }',
  "client/silent-catch.ts": 'export function read(){ try { run(); } catch {} }',
  "client/handled-catch.ts": 'function unsupported(): never { throw new Error("unsupported"); } export function read(){ try { run(); } catch { unsupported(); } }',
  "server/silent-catch.ts": 'import "server-only"; export function read(){ try { run(); } catch {} }',
  "client/policy.ts": 'export const policy = "frame-ancestors none"; export const readHeader = () => "frame-ancestors none";',
  "client/policy.test.ts": 'import { expect, test } from "bun:test"; import { policy } from "./policy"; test("x", () => { expect(readHeader()).toBe(policy); });',
  "client/policy-clean.test.ts": 'import { expect, test } from "bun:test"; import { policy, readHeader } from "./policy"; test("x", () => { expect(readHeader()).toBe("frame-ancestors none"); expect(policy).toBe("frame-ancestors none"); });',
  "client/constant-pin.test.ts": 'import { expect, test } from "bun:test"; import { TUNING_LIMIT } from "./limits"; test("x", () => { expect(TUNING_LIMIT).toBe(10); });',
  "client/constant-pin-clean.test.ts": 'import { expect, test } from "bun:test"; import { BASE_CHAIN_ID, readLimit } from "./limits"; test("x", () => { expect(BASE_CHAIN_ID).toBe(8453); expect(readLimit()).toBe(10); });',

  "client/raw.tsx": 'export function A(){ return <><button>go</button><input/><select/></> }',
  "components/raw.tsx": 'export function A(){ return <><button>go</button><input/><select/></> }',
  "client/landing/supported-globe.tsx": 'export function A(){ return <button>go</button> }',
  "client/detached.tsx": 'const tone="text-primary"; export function A(){ return <div className={tone}/> }',
  "client/detached-aggregate.tsx": 'const styles={active:"text-primary",idle:"text-muted-foreground"}; export function A({state}:{state:string}){ return <div className={styles[state]}/> }',
  "client/detached-aggregate-clean.tsx": 'const data={active:"text-primary",count:2}; export function A({state}:{state:keyof typeof data}){ return <div className={data[state]}/> }',
  "server/source-read.test.ts": 'import x from "fs"; export { y } from "node:fs/promises"; export * from "fs/promises"; const a=import("node:fs"); const b=import(`fs/promises`); const c=require("fs"); const d=require(`node:fs`); const e=Bun.file("x"); export {x,a,b,c,d,e};',
  "tests/helpers/migrations.ts": 'import { readFile } from "node:fs/promises"; Bun.sleep(1); export { readFile };',
  "tests/well-known/apple-pay-domain-association.test.ts": 'import { readFile } from "node:fs/promises"; export function x(e: Element){ return [readFile, e.className] }',
  "client/waits.test.tsx": 'setTimeout(()=>{},51); setInterval(()=>{},52); Bun.sleep(1); waitFor(()=>{}, {timeout:2001});',
  "client/waits-clean.test.tsx": 'setTimeout(()=>{},50); setInterval(()=>{},50); waitFor(()=>{}, {timeout:2000});',
  "tests/browser/waits.pw.ts": 'page.waitForTimeout(1); frame.waitForTimeout(1); new Promise(resolve=>setTimeout(resolve, delay));',
  "tests/browser/waits-clean.pw.ts": 'await expect.poll(readStatus).toBe("ready"); await page.getByRole("button").waitFor();',
  "tests/browser/request-only.pw.ts": 'import { test } from "@playwright/test"; test("x", async ({ request }) => { await request.get("/"); });',
  "tests/browser/request-only-clean.pw.ts": 'import { test } from "@playwright/test"; test("x", async ({ page, request }) => { await page.goto("/"); await request.get("/"); });',
  "client/classes.test.tsx": 'export function x(e: Element){ const a=e.className; const b=e.classList.contains("x"); const c=e.getAttribute("class"); return [a,b,c] }',
  "client/classes-clean.test.tsx": 'export function x(e: Element){ e.className="x"; e.classList.add("y"); e.classList.remove("z"); e.classList.toggle("a"); e.classList.replace("a","b") }',
  "client/computed.test.tsx": 'export function x(e: Element){ return [getComputedStyle(e), window.getComputedStyle(e), globalThis["getComputedStyle"](e)] }',
  "client/computed.stories.tsx": 'export function x(e: Element){ return getComputedStyle(e) }',
  "client/computed-clean.test.tsx": 'export function x(e: Element){ return e.getAttribute("aria-label") }',
  "client/computed-clean.stories.tsx": 'export function x(e: Element){ return e.getAttribute("aria-label") }',
  "tests/browser/computed.pw.ts": 'export function x(e: Element){ return getComputedStyle(e) }',
  "client/computed.tsx": 'export function x(e: Element){ return window.getComputedStyle(e) }',
  "client/location.tsx": 'location.assign("next"); window.location.replace(`later`); location.href="relative";',
  "client/location-clean.tsx": 'location.assign("/next"); window.location.replace("https://example.com"); location.href="#top";',
  "client/anti-slop.ts": 'type V = unknown; export function x(value: string, arg: object){ const a=value as unknown as number; Reflect.get({}, "x"); Reflect.apply(()=>0,null,[]); return [arg,a].reduce((all,v)=>({...all,[String(v)]:v}),{}); }',
  "client/reducer-copy.ts": 'export const a=["x"].reduceRight((all,item)=>Object.assign({},all,{[item]:1}),{}); export const b=["x"].reduce((all,item)=>{const alias=all;if(item)return Array.from(alias);return all},[] as string[]);',
  "client/reducer-copy-clean.ts": 'export const a=["x"].reduce((all,item)=>Object.assign(all,{[item]:1}),{}); declare const custom:{concat(value:string):unknown}; export const b=["x"].reduce((all,item)=>all.concat(item),custom);',
  "client/reducer-spread-clean.ts": 'export const a=[{x:1}].reduce((all,item)=>({...item}),{}); const defaults={x:1}; export const b=["x"].reduce((all,item)=>({...defaults,[item]:1}),{}); export const c=[["x"]].reduce((all,item)=>([...item]),[]);',
  "client/widen-then-assert.ts": 'const source={id:"x"};const erased:unknown=source;export const value=(erased) as {id:string};',
  "client/widen-then-assert-clean.ts": 'declare const input:unknown;export const parsed=input as {id:string};const byRuntimeKey:Record<string,{id:string}>={};byRuntimeKey[parsed.id]=parsed;const fixture:Record<string,string>[]=[];fixture.push({id:parsed.id});',
  "client/mock-rejected.test.tsx": 'import { mock } from "bun:test"; const name="x"; mock.module("other",()=>({})); mock.module(name,()=>({}));',
  "client/mock-bindings-rejected.test.tsx": 'import { mock as bunMock } from "bun:test"; import * as bunTest from "bun:test"; const alias=bunMock; bunMock.module("other",()=>({})); bunTest.mock.module("other",()=>({})); alias.module("other",()=>({})); bunMock["module"]("other",()=>({}));',
  "client/mock-unrelated-clean.test.tsx": 'const mock={module(_name:string,_factory:()=>object){}}; const bunTest={mock}; mock.module("other",()=>({})); bunTest.mock["module"]("other",()=>({}));',
  "client/funding/funding-actions.test.tsx": 'import { mock } from "bun:test"; void mock.module("next/navigation",()=>({}));',
  "nested/client/funding/funding-actions.test.tsx": 'import { mock } from "bun:test"; mock.module("next/navigation",()=>({}));',
  "tests/server-only-preload.ts": 'import { mock } from "bun:test"; mock.module("server-only",()=>({}));',
  "tests/unreviewed-preload.ts": 'import { mock } from "bun:test"; mock.module("server-only",()=>({}));',
  "app/shadcn.tsx": 'import { Button } from "@/components/ui/button"; export function A(){ return <Button className="rounded-full">x</Button> }',
  "client/shadcn.tsx": 'import { Button } from "@/components/ui/button"; export function A(){ return <Button className="rounded-full">x</Button> }',
  "components/shadcn.tsx": 'import { Button } from "@/components/ui/button"; export function A(){ return <Button className="rounded-full">x</Button> }',
  "client/shadcn-clean.tsx": 'import { Button } from "@/components/ui/button"; export function A(){ return <Button className="w-full">x</Button> }',
  "client/shadcn-relative.tsx": 'import { Button } from "../components/ui/button"; export function A(){ return <Button className="rounded-full">x</Button> }',
  "client/shadcn-relative-clean.tsx": 'import { Button } from "../components/ui/button"; export function A(){ return <Button className="w-full">x</Button> }',
  "components/ui/restyle-clean.tsx": 'import { Button } from "@/components/ui/button"; export function A(){ return <Button className="rounded-full">x</Button> }',
  "client/restyle-clean.test.tsx": 'import { Button } from "@/components/ui/button"; export function A(){ return <Button className="rounded-full">x</Button> }',
  "client/restyle-clean.stories.tsx": 'import { Button } from "@/components/ui/button"; export function A(){ return <Button className="rounded-full">x</Button> }',
  "client/native.tsx": 'import { useState } from "react"; export default function A({x}:{x:any}){ if(x) useState(0); return <img/> }',
  "client/type-aware.ts": 'export function f(){ Promise.resolve(1); }',
  "client/type-aware-promise.ts": 'declare function consume(cb: () => void): void; async function handler(){ return 1; } export function run(){ consume(handler); }',
  "client/type-aware-switch.ts": 'type Kind = "a" | "b" | "c"; export function pick(k: Kind): string { switch (k) { case "a": return "a"; case "b": return "b"; } }',
  "client/type-aware-switch-clean.ts": 'type Kind = "a" | "b" | "c"; export function pick(k: Kind): string { switch (k) { case "a": return "a"; default: return "z"; } }',
  "client/unknown-class.tsx": 'export function A(){ return <div className="panel-fade">x</div>; }',
  "client/unknown-class-clean.tsx": 'export function A(){ return <div className="p-4 bg-primary text-muted-foreground sm:order-2">x</div>; }',
  "client/unknown-class-marker.tsx": 'export function A(){ return <div className="group/tabs-list shell-scroll-container">x</div>; }',
  "client/unknown-class.test.tsx": 'export function A(){ return <div className="panel-fade">x</div>; }',
  "client/jsx-color.tsx": 'export function A(){ return <svg><circle stroke="white" /><path fill="#fff" /></svg>; }',
  "client/jsx-color-clean.tsx": 'export function A(){ return <svg><circle fill="var(--primary)" stroke="currentColor" /><path fill="none" /></svg>; }',
  "components/currency-mark.tsx": 'export function EthMark(){ return <svg><circle fill="#627EEA" /><path fill="#fff" /></svg>; }',
  "components/jsx-color-plain.tsx": 'export function A(){ return <svg><circle fill="#fff" /></svg>; }',
  "client/unsafe-assignment.ts": 'export const value: string = JSON.parse("null");',
  "client/unsafe-return.ts": 'export function read(): string { return JSON.parse("null"); }',
  "app/unsafe-values.ts": 'export const value: string = JSON.parse("null"); export function read(): string { return JSON.parse("null"); }',
  "server/unsafe-values.ts": 'import "server-only"; export const value: string = JSON.parse("null"); export function read(): string { return JSON.parse("null"); }',
  "client/unsafe-typed-clean.ts": 'export const value: string = "typed"; export function read(): string { return value; }',
  "client/unsafe-boundary-clean.ts": 'export function read(): string | null { const value: unknown = JSON.parse("null"); return typeof value === "string" ? value : null; }',
  "client/unsafe-values.test.ts": 'export const value: string = JSON.parse("null"); export function read(): string { return JSON.parse("null"); }',
  "client/unsafe-values.stories.tsx": 'export const value: string = JSON.parse("null"); export function read(): string { return JSON.parse("null"); }',
  "server/cdp/sdk-any.ts": 'import "server-only"; declare function readSdk(): any; export const address = readSdk().address;',
  "server/cdp/sdk-typed-clean.ts": 'import "server-only"; declare function readSdk(): { address: string }; export const address = readSdk().address;',
  "server/cdp/sdk-boundary-clean.ts": 'import "server-only"; declare const value: unknown; export function address(){ if (!value || typeof value !== "object" || !("address" in value)) return null; return value.address; }',
  "server/request-json-inline.ts": 'import "server-only"; export async function read(request: Request) { return await request.json(); }',
  "server/request-json-clean.ts": 'import "server-only"; export function read() { return Response.json({ ok: true }); }',
  "shared/http/request-json-helper.ts": 'export async function read(body: Request | Response) { return await body.json(); }',
  "client/request-json-inline.ts": 'export async function read(request: Request) { return await request.json(); }',
  "server/manual-abort-timeout.ts": 'import "server-only"; export function schedule(controller: AbortController) { return setTimeout(() => controller.abort(), 1000); }',
  "server/manual-abort-timeout-clean.ts": 'import "server-only"; export function schedule(resolve: () => void) { return setTimeout(resolve, 1000); }',
  "server/http/manual-abort-timeout.ts": 'import "server-only"; export function schedule(controller: AbortController) { return setTimeout(() => controller.abort(), 1000); }',
  "server/paymaster/client.ts": 'import "server-only"; export function schedule(controller: AbortController) { return setTimeout(() => controller.abort(), 1000); }',
  "client/manual-abort-timeout.ts": 'export function schedule(controller: AbortController) { return setTimeout(() => controller.abort(), 1000); }',
  "client/fetch-get.ts": 'export async function load() { return await fetch("/api/thing"); }',
  "client/fetch-post-clean.ts": 'export async function save(body: string) { return await fetch("/api/thing", { method: "POST", body }); }',
  "client/fetch-passthrough-clean.ts": 'export const send = (url: string, init: RequestInit) => fetch(url, init);',
  "server/fetch-get.ts": 'import "server-only"; export async function load() { return await fetch("/api/thing"); }',
  "client/query-key-inline.ts": 'export const options = { queryKey: ["balances"], queryFn: async () => 1 };',
  "client/query-key-alias.ts": 'const key = ["balances"]; export const options = { queryKey: key, queryFn: async () => 1 };',
  "client/query-key-factory-clean.ts": 'export function options(owner: string) { return { queryKey: ownerQueryKey(owner, "balances"), queryFn: async () => 1 }; }',
  "server/query-key-inline.ts": 'import "server-only"; export const options = { queryKey: ["balances"], queryFn: async () => 1 };',
  "shared/address-literal.ts": 'export const addressPattern = /^0x[0-9a-fA-F]{40}$/;',
  "shared/address-literal-clean.ts": 'export const zeroAddress = /^0x0{40}$/i; export const hashPattern = /^0x[0-9a-fA-F]{64}$/;',
  "shared/formatting/address.ts": 'export const addressPattern = /^0x[0-9a-fA-F]{40}$/;',
  "shared/address-literal.test.ts": 'export const addressPattern = /^0x[0-9a-fA-F]{40}$/;',
  "app/request-json-inline.ts": 'export async function read(request: Request) { return await request.json(); }',
  "shared/request-json-inline.ts": 'export async function read(request: Request) { return await request.json(); }',
  "server/request-json-inline.test.ts": 'export async function read(request: Request) { return await request.json(); }',
  "shared/request-json-inline.stories.tsx": 'export async function read(request: Request) { return await request.json(); }',
  "shared/request-json-inline.stories.fixture.ts": 'export async function read(request: Request) { return await request.json(); }',
  "shared/request-json-inline.test.variant.ts": 'export async function read(request: Request) { return await request.json(); }',
  "tests/request-json-inline.ts": 'export async function read(request: Request) { return await request.json(); }',
  "shared/testing/request-json-inline.ts": 'export async function read(request: Request) { return await request.json(); }',
  "shared/explorations/request-json-inline.ts": 'export async function read(request: Request) { return await request.json(); }',
  "server/manual-abort-timeout.test.ts": 'import "server-only"; export function schedule(controller: AbortController) { return setTimeout(() => controller.abort(), 1000); }',
  "components/fetch-get.ts": 'export async function load() { return await fetch("/api/thing"); }',
  "client/fetch-get.test.ts": 'export async function load() { return await fetch("/api/thing"); }',
  "client/fetch-get.stories.tsx": 'export async function load() { return await fetch("/api/thing"); }',
  "client/explorations/fetch-get.ts": 'export async function load() { return await fetch("/api/thing"); }',
  "components/fetch-get.stories.fixture.ts": 'export async function load() { return await fetch("/api/thing"); }',
  "components/query-key-inline.ts": 'export const options = { queryKey: ["balances"], queryFn: async () => 1 };',
  "client/query-key-inline.test.ts": 'export const options = { queryKey: ["balances"], queryFn: async () => 1 };',
  "client/query-key-inline.stories.tsx": 'export const options = { queryKey: ["balances"], queryFn: async () => 1 };',
  "client/explorations/query-key-inline.ts": 'export const options = { queryKey: ["balances"], queryFn: async () => 1 };',
  "app/address-literal.ts": 'export const addressPattern = /^0x[0-9a-fA-F]{40}$/;',
  "client/address-literal.ts": 'export const addressPattern = /^0x[0-9a-fA-F]{40}$/;',
  "components/address-literal.ts": 'export const addressPattern = /^0x[0-9a-fA-F]{40}$/;',
  "server/address-literal.ts": 'export const addressPattern = /^0x[0-9a-fA-F]{40}$/;',
  "config/address-literal.ts": 'export const addressPattern = /^0x[0-9a-fA-F]{40}$/;',
  "oxlint/address-literal.ts": 'export const addressPattern = /^0x[0-9a-fA-F]{40}$/;',
  "shared/address-literal.stories.tsx": 'export const addressPattern = /^0x[0-9a-fA-F]{40}$/;',
  "shared/explorations/address-literal.ts": 'export const addressPattern = /^0x[0-9a-fA-F]{40}$/;',
  "server/address-literal.stories.fixture.ts": 'export const addressPattern = /^0x[0-9a-fA-F]{40}$/;',
  "client/address-literal.test.variant.ts": 'export const addressPattern = /^0x[0-9a-fA-F]{40}$/;',
  "client/address-literal-test-harness.ts": 'export const addressPattern = /^0x[0-9a-fA-F]{40}$/;',
  "server/explorations/manual-abort-timeout.ts": 'import "server-only"; export function schedule(controller: AbortController) { return setTimeout(() => controller.abort(), 1000); }',
  "server/testing/manual-abort-timeout.ts": 'import "server-only"; export function schedule(controller: AbortController) { return setTimeout(() => controller.abort(), 1000); }',
  "server/manual-abort-timeout.stories.tsx": 'import "server-only"; export function schedule(controller: AbortController) { return setTimeout(() => controller.abort(), 1000); }',
  "server/manual-abort-timeout.stories.fixture.ts": 'import "server-only"; export function schedule(controller: AbortController) { return setTimeout(() => controller.abort(), 1000); }',
  "server/manual-abort-timeout.test.variant.ts": 'import "server-only"; export function schedule(controller: AbortController) { return setTimeout(() => controller.abort(), 1000); }',
  "server/manual-abort-timeout-test-harness.ts": 'import "server-only"; export function schedule(controller: AbortController) { return setTimeout(() => controller.abort(), 1000); }',
  "server/request-json-inline-test-harness.ts": 'export async function read(request: Request) { return await request.json(); }',
  "server/testing/request-json-inline.ts": 'export async function read(request: Request) { return await request.json(); }',
  "client/testing/fetch-get.ts": 'export async function load() { return await fetch("/api/thing"); }',
  "client/fetch-get.test.variant.ts": 'export async function load() { return await fetch("/api/thing"); }',
  "client/fetch-get.stories.fixture.ts": 'export async function load() { return await fetch("/api/thing"); }',
  "client/fetch-get-test-harness.ts": 'export async function load() { return await fetch("/api/thing"); }',
  "client/testing/query-key-inline.ts": 'export const options = { queryKey: ["balances"], queryFn: async () => 1 };',
  "client/query-key-inline.test.variant.ts": 'export const options = { queryKey: ["balances"], queryFn: async () => 1 };',
  "client/query-key-inline.stories.fixture.ts": 'export const options = { queryKey: ["balances"], queryFn: async () => 1 };',
  "client/query-key-inline-test-harness.ts": 'export const options = { queryKey: ["balances"], queryFn: async () => 1 };',
  "shared/testing/address-literal.ts": 'export const addressPattern = /^0x[0-9a-fA-F]{40}$/;',
  "client/address-literal-test-harness.probe.ts": 'export const addressPattern = /^0x[0-9a-fA-F]{40}$/;',
  "server/http/request-json-inline.ts": 'export async function read(request: Request) { return await request.json(); }',
  "server/tests/request-json-inline.ts": 'export async function read(request: Request) { return await request.json(); }',
  "server/request-json-inline-test-harness.probe.ts": 'export async function read(request: Request) { return await request.json(); }',
  "server/manual-abort-timeout-test-harness.probe.ts": 'import "server-only"; export function schedule(controller: AbortController) { return setTimeout(() => controller.abort(), 1000); }',
  "server/tests/manual-abort-timeout.ts": 'import "server-only"; export function schedule(controller: AbortController) { return setTimeout(() => controller.abort(), 1000); }',
  "client/tests/fetch-get.ts": 'export async function load() { return await fetch("/api/thing"); }',
  "client/fetch-get-test-harness.probe.ts": 'export async function load() { return await fetch("/api/thing"); }',
  "client/tests/query-key-inline.ts": 'export const options = { queryKey: ["balances"], queryFn: async () => 1 };',
  "client/query-key-inline-test-harness.probe.ts": 'export const options = { queryKey: ["balances"], queryFn: async () => 1 };',
  "shared/tests/address-literal.ts": 'export const addressPattern = /^0x[0-9a-fA-F]{40}$/;',
  "node_modules/ignored.ts": 'const x: any = 1;',
  ".next/ignored.ts": 'const x: any = 1;',
  "storybook-static/ignored.ts": 'const x: any = 1;'
};

for (const directory of [...boundary.requiredFence, ...boundary.exempt]) {
  fixtures[`${directory}/__exploration-boundary-probe.ts`] = 'export * from "./explorations/probe";';
}
const declarationProbe = 'export type BoundaryProbe = typeof import("./explorations/probe");';
const rootProbe = (file) => /\.d\.(?:ts|mts|cts)$/.test(file) ? declarationProbe : 'void import("./explorations/probe");';
for (const file of rootFiles) {
  if (!Object.hasOwn(fixtures, file)) fixtures[file] = rootProbe(file);
}
fixtures["middleware.ts"] = rootProbe("middleware.ts");
fixtures["__exploration-boundary-root-probe.ts"] = rootProbe("__exploration-boundary-root-probe.ts");
fixtures["__exploration-boundary-root-probe.cjs"] = rootProbe("__exploration-boundary-root-probe.cjs");
fixtures["__exploration-boundary-root-probe.cts"] = rootProbe("__exploration-boundary-root-probe.cts");
fixtures["__exploration-boundary-root-probe.d.ts"] = rootProbe("__exploration-boundary-root-probe.d.ts");
fixtures["__exploration-boundary-root-probe.d.mts"] = rootProbe("__exploration-boundary-root-probe.d.mts");
fixtures["__exploration-boundary-root-probe.d.cts"] = rootProbe("__exploration-boundary-root-probe.d.cts");
fixtures["verify.stories.foo.ts"] = rootProbe("verify.stories.foo.ts");
fixtures["a.stories..ts"] = rootProbe("a.stories..ts");

assert.ok(Object.keys(fixtures).length > 0, "Oxlint contract fixtures must not be empty");

for (const [relativePath, contents] of Object.entries(fixtures)) {
  const destination = path.join(mirror, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, contents);
}

const binary = path.join(appsWebDir, "node_modules/.bin/oxlint");
const run = spawnSync(binary, ["-c", ".oxlintrc.jsonc", "--disable-nested-config", "--deny-warnings", "--report-unused-disable-directives", "-f", "json", "."], { cwd: mirror, encoding: "utf8" });
assert.equal(run.signal, null, run.stderr);
assert.equal(run.status, 1, "violating mirror must fail");
const output = JSON.parse(run.stdout);
const diagnostics = output.diagnostics;
assert.ok(diagnostics.length > 0, "violating mirror must produce diagnostics");

const debug = spawnSync(binary, ["-c", ".oxlintrc.jsonc", "--disable-nested-config", "--debug", "files", "."], { cwd: mirror, encoding: "utf8" });
assert.equal(debug.status, 0, debug.stderr);
const listedFiles = new Set(`${debug.stdout}\n${debug.stderr}`
  .split(/\r?\n/)
  .map((line) => line.trim().replace(/^\.\//, ""))
  .filter(Boolean));
assert.ok(listedFiles.size > 0, "Oxlint must list parsed files");
const ignoredFixturePattern = /^(?:node_modules|\.next|storybook-static)\//;

function hits(file, code) {
  return diagnostics.filter((diagnostic) => diagnostic.filename === file && diagnostic.code === code);
}
function assertHits(file, code, count = 1) {
  assert.equal(hits(file, code).length, count, `${file} expected ${count} ${code}; got ${JSON.stringify(diagnostics.filter((d) => d.filename === file).map((d) => [d.code, d.message]))}`);
}
function assertClean(file) {
  assert.deepEqual(diagnostics.filter((diagnostic) => diagnostic.filename === file), [], `${file} must be covered and clean`);
}

const contracts = [
  ["workshop imports cover static, export, dynamic, template, and require", () => { assertHits("client/storybook.tsx", "home(no-storybook-imports)", 4); assertHits("config/storybook.ts", "home(no-storybook-imports)"); assertHits("types/storybook.d.ts", "home(no-storybook-imports)"); }],
  ["exploration imports block production barrels and app, server, shared modules", () => { assertHits("components/barrel.ts", "home(no-exploration-imports)", 5); for (const file of ["app/exploration-leak.ts", "server/exploration-leak.ts", "shared/exploration-leak.ts"]) assertHits(file, "home(no-exploration-imports)"); }],
  ["test-support aliases and relative imports are blocked in production", () => { for (const file of ["client/test-support-relative.ts", "client/test-support-alias.ts", "server/test-support-relative.ts"]) assertHits(file, "home(no-test-support-imports)"); }],
  ["test-support dynamic, template, require, and type-query imports are blocked", () => { assertHits("client/test-support-dynamic.ts", "home(no-test-support-imports)", 3); assertHits("client/test-support-type-query.ts", "home(no-test-support-imports)"); }],
  ["test modules are blocked with and without an extension", () => assertHits("client/test-support-modules.ts", "home(no-test-support-imports)", 2)],
  ["test-support barrels cannot expose exploration code to production", () => { assertHits("client/testing/barrel.ts", "home(no-exploration-imports)", 0); assertHits("client/testing/barrel.ts", "home(no-test-support-imports)", 0); assertClean("client/testing/barrel.ts"); assertHits("client/barrel-consumer.ts", "home(no-test-support-imports)"); }],
  ["test-support imports stay clean in tests, stories, and test helpers", () => { for (const file of ["client/test-support-import.test.ts", "client/test-support-import.stories.tsx", "tests/helpers/test-support-import.ts"]) assertClean(file); }],
  ["similarly named paths and testing-library imports stay clean", () => { assertClean("client/test-support-names.ts"); assertClean("client/test-support-package.ts"); }],
  ["root entry points are covered without treating tooling entry-point names as production", () => { assertHits("proxy.ts", "home(no-test-support-imports)"); assertHits("scripts/device-profile/proxy.ts", "home(no-test-support-imports)", 0); }],
  ["test harnesses and nested tooling entry-point names stay clean", () => { assertClean("client/account/dom-test-harness.ts"); assertClean("scripts/device-profile/proxy.ts"); }],
  ["test-support specifiers normalize backslashes and traversal without checkout ancestry", () => { assertHits("client/test-support-windows.ts", "home(no-test-support-imports)"); assertClean("client/test-support-alias-traversal-clean.ts"); assertClean("client/test-support-relative-traversal-clean.ts"); }],
  ["test harnesses are exempt importers but blocked production targets", () => { assertHits("client/test-support-harness-consumer.ts", "home(no-test-support-imports)"); assertHits("client/probe-test-harness.ts", "home(no-test-support-imports)", 0); assertHits("client/probe-test-harness.ts", "home(no-exploration-imports)", 0); assertClean("client/probe-test-harness.ts"); }],
  ["partial traversal fragments preserve known test-support segments", () => { assertHits("client/test-support-fragment-traversal.ts", "home(no-test-support-imports)", 2); assertClean("client/test-support-alias-traversal-clean.ts"); assertClean("client/test-support-relative-traversal-clean.ts"); }],
  ["complete test-support specifiers fully normalize trailing traversal", () => { assertClean("client/test-support-complete-traversal-clean.ts"); assertClean("client/test-support-alias-complete-traversal-clean.ts"); }],
  ["redundant alternatives retain a late test-support branch", () => assertHits("client/test-support-overflow-late-branch.ts", "home(no-test-support-imports)", 1)],
  ["redundant alternatives preserve cross-operand test-support joins", () => assertHits("client/test-support-overflow-joined-split.ts", "home(no-test-support-imports)", 1)],
  ["redundant alternatives keep complete production prefixes clean", () => assertClean("client/test-support-overflow-prefix-clean.ts")],
  ["a distinct overflowing product retains a late test-support branch", () => assertHits("client/test-support-overflow-distinct-late-branch.ts", "home(no-test-support-imports)", 1)],
  ["test declarations are exempt importers but blocked production targets", () => { assertClean("types/helper.test.d.ts"); assertHits("client/test-support-declaration.ts", "home(no-test-support-imports)"); }],
  ["test-harness declarations are exempt importers but blocked production targets", () => { assertClean("types/probe-test-harness.d.ts"); assertHits("client/harness-declaration-consumer.ts", "home(no-test-support-imports)"); }],
  ["type-query references from production modules are blocked", () => assertHits("client/exploration-type-query.ts", "home(no-exploration-imports)", 2)],
  ["TypeScript-parsed JSDoc references cannot reach explorations from production JS or TS", () => { for (const file of ["config/exploration-jsdoc.js", "config/exploration-jsdoc-import.js", "config/exploration-jsdoc-braceless.js", "config/exploration-jsdoc-escaped.js", "config/exploration-jsdoc-inline.js", "config/exploration-jsdoc-prose-quote.js", "config/exploration-jsdoc-unterminated.js", "config/exploration-jsdoc-wrapped.js", "config/exploration-jsdoc-typescript.ts"]) assertHits(file, "home(no-exploration-imports)", 1); assertHits("config/exploration-jsdoc-import-edge.js", "home(no-exploration-imports)", 2); assertClean("config/exploration-jsdoc-clean.js"); assertClean("config/exploration-jsdoc-prose-clean.js"); assertClean("config/exploration-jsdoc-no-tags.js"); assertHits("client/explorations/jsdoc.js", "home(no-exploration-imports)", 0); }],
  ["interpolated exploration specifiers block knowable path segments", () => { assertHits("client/exploration-template.ts", "home(no-exploration-imports)", 2); assertHits("client/exploration-template-clean.ts", "home(no-exploration-imports)", 0); }],
  ["TypeScript assertion wrappers around exploration specifiers are checked", () => assertHits("client/exploration-assertions.ts", "home(no-exploration-imports)", 3)],
  ["angle-bracket assertions are checked", () => assertHits("client/exploration-angle-assertion.ts", "home(no-exploration-imports)")],
  ["root JS entry points and TS proxy are covered", () => { for (const file of ["proxy.ts", "proxy.js", "instrumentation.js", "next.config.mjs"]) assertHits(file, "home(no-exploration-imports)"); }],
  ["every top-level production directory is fenced", () => {
    assert.deepEqual(boundary.stale, []);
    assert.deepEqual(boundary.invalid, []);
    for (const directory of boundary.requiredFence) assertHits(`${directory}/__exploration-boundary-probe.ts`, "home(no-exploration-imports)");
  }],
  ["every root-level production file is fenced", () => {
    assert.deepEqual(boundary.stale, []);
    assert.deepEqual(boundary.invalid, []);
    for (const file of boundary.requiredRootFence) assertHits(file, "home(no-exploration-imports)", 1);
  }],
  ["reasoned root-file exemptions sit outside the boundary", () => {
    assert.deepEqual(boundary.stale, []);
    assert.deepEqual(boundary.invalid, []);
    for (const file of boundary.exemptRootFiles) assertHits(file, "home(no-exploration-imports)", 0);
  }],
  ["preclassified root test, story, and test-harness files sit outside the boundary", () => {
    assert.deepEqual(boundary.stale, []);
    assert.deepEqual(boundary.invalid, []);
    for (const file of boundary.preclassifiedRootFiles) assertHits(file, "home(no-exploration-imports)", 0);
  }],
  ["a new root-level entry file is fenced", () => {
    for (const file of ["middleware.ts", "__exploration-boundary-root-probe.ts", "__exploration-boundary-root-probe.cjs", "__exploration-boundary-root-probe.cts", "__exploration-boundary-root-probe.d.ts", "__exploration-boundary-root-probe.d.mts", "__exploration-boundary-root-probe.d.cts", "verify.stories.foo.ts", "a.stories..ts"]) assertHits(file, "home(no-exploration-imports)");
  }],
  ["non-production exemptions sit outside the boundary", () => {
    assert.deepEqual(boundary.stale, []);
    assert.deepEqual(boundary.invalid, []);
    for (const directory of boundary.exempt) assertHits(`${directory}/__exploration-boundary-probe.ts`, "home(no-exploration-imports)", 0);
  }],
  ["concatenated and interpolated exploration imports reject only known exploration paths", () => { assertHits("client/exploration-concatenated.ts", "home(no-exploration-imports)", 3); assertHits("client/exploration-concatenated-clean.ts", "home(no-exploration-imports)", 0); }],
  ["non-static concatenation checks known segments on both sides", () => assertHits("client/exploration-concatenated-dynamic.ts", "home(no-exploration-imports)", 4)],
  ["split static template fragments still reveal knowable exploration segments", () => { assertHits("client/exploration-split-template.ts", "home(no-exploration-imports)", 2); }],
  ["cross-boundary known runs still reveal knowable exploration segments", () => { assertHits("client/exploration-cross-boundary.ts", "home(no-exploration-imports)", 2); assertHits("client/exploration-cross-boundary-clean.ts", "home(no-exploration-imports)", 0); }],
  ["conditional and logical specifiers are traversed", () => { assertHits("client/exploration-conditional.ts", "home(no-exploration-imports)", 2); assertHits("client/exploration-conditional-clean.ts", "home(no-exploration-imports)", 0); }],
  ["branch alternatives inside a concatenation are traversed", () => assertHits("client/exploration-conditional-concat.ts", "home(no-exploration-imports)", 1)],
  ["an unknown segment splits known runs so a false positive cannot form", () => assertHits("client/exploration-unknown-segment-clean.ts", "home(no-exploration-imports)", 0)],
  ["an overflowing alternative product still flags a known exploration segment", () => assertHits("client/exploration-overflow.ts", "home(no-exploration-imports)", 1)],
  ["an overflowing product still flags a path split across a late branch", () => assertHits("client/exploration-overflow-merge.ts", "home(no-exploration-imports)", 1)],
  ["mutually exclusive branches are not joined into a false positive", () => assertHits("client/exploration-mutually-exclusive-clean.ts", "home(no-exploration-imports)", 0)],
  ["story fixtures are design-lane and stay clean", () => assertClean("client/exploration-fixture.stories.fixture.ts")],
  ["exploration files, stories, tests, and similarly named paths stay clean", () => { for (const file of ["client/explorations/inside.ts", "client/explorations/nested.ts", "client/exploration-import.stories.tsx", "client/exploration-import.test.ts", "client/exploration-names.ts"]) assertHits(file, "home(no-exploration-imports)", 0); }],
  ["client layer aliases and relative paths are fenced", () => assertHits("client/layers.ts", "home(no-client-server-imports)", 4)],
  ["server layer aliases and relative paths are fenced", () => assertHits("server/layers.ts", "home(no-server-client-imports)", 3)],
  ["shared stays runtime agnostic", () => assertHits("shared/layers.ts", "home(no-shared-runtime-imports)", 4)],
  ["classic zod imports reject all syntax forms in browser-facing layers", () => { assertHits("client/classic-zod.ts", "home(no-classic-zod-imports)", 3); assertHits("components/classic-zod.ts", "home(no-classic-zod-imports)", 2); assertHits("shared/classic-zod.ts", "home(no-classic-zod-imports)", 4); assertClean("shared/mini-zod.ts"); assertClean("server/classic-zod.ts"); }],
  ["browser SDKs stay in the account owner fence", () => { assertHits("app/sdk.ts", "home(no-browser-sdk-imports)"); assertHits("client/sdk.ts", "home(no-browser-sdk-imports)"); assertHits("components/sdk.ts", "home(no-browser-sdk-imports)"); assertHits("shared/sdk.ts", "home(no-browser-sdk-imports)"); assertClean("client/account/sdk.tsx"); }],
  ["base-ui primitives stay in owned wrappers", () => { assertHits("app/base-ui.tsx", "home(no-base-ui-imports)"); assertHits("client/base-ui.tsx", "home(no-base-ui-imports)"); assertHits("components/base-ui.tsx", "home(no-base-ui-imports)"); assertHits("server/base-ui.ts", "home(no-base-ui-imports)"); assertHits("shared/base-ui.ts", "home(no-base-ui-imports)"); }],
  ["server marker is first", () => { assertHits("server/no-marker.ts", "home(require-server-only)"); assertHits("server/late-marker.ts", "home(require-server-only)"); assertClean("server/clean.ts"); }],
  ["formatting is centralized", () => { assertHits("client/format.tsx", "home(no-local-formatting)", 6); assertClean("shared/formatting/clean.ts"); }],
  ["money amounts preserve unavailable state instead of defaulting to zero", () => { assertHits("shared/formatting/amount-fallback.ts", "home(no-amount-fallback)", 3); assertClean("shared/formatting/amount-fallback-clean.ts"); }],
  ["literal utility styles reject all supported expression forms", () => { assertHits("client/styles.tsx", "home(no-literal-utility-styles)", 4); assertClean("client/styles-clean.tsx"); }],
  ["descendant has selectors fail under the production rule configuration", () => assertHits("client/has-policy.tsx", "home(no-descendant-has)")],
  ["a document-root subject reached through a functional pseudo-class fails under the production rule configuration", () => assertHits("client/root-has-policy.tsx", "home(no-descendant-has)")],
  ["an upper-case document-root subject fails under the production rule configuration", () => assertHits("client/root-case-policy.tsx", "home(no-descendant-has)")],
  ["important utilities fail under the production rule configuration", () => assertHits("client/important-policy.tsx", "home(no-important-utilities)")],
  ["important utilities in stories stay outside the product rule", () => { assertClean("client/important-policy.stories.tsx"); assertClean("stories/important-policy.tsx"); }],
  ["raw controls use owned wrappers in every product layer", () => { assertHits("app/raw.tsx", "home(no-raw-buttons)"); assertHits("client/raw.tsx", "home(no-raw-buttons)"); assertHits("components/raw.tsx", "home(no-raw-buttons)"); }],
  ["product comments are rejected in all five layers while documented exceptions and tests stay clean", () => { for (const file of ["app/comment.mjs", "client/comment.ts", "components/comment.jsx", "server/comment.ts", "shared/comment.tsx"]) assertHits(file, "home(no-comments)"); assertClean("shared/comment-clean.ts"); assertClean("client/comment-clean.test.ts"); assertClean("client/comment-clean.stories.tsx"); }],
  ["silent catches fail while typed recovery values pass in every covered layer", () => { assertHits("app/silent-catch.ts", "home(no-silent-catch)"); assertHits("client/silent-catch.ts", "home(no-silent-catch)"); assertHits("server/silent-catch.ts", "home(no-silent-catch)"); assertClean("app/handled-catch.ts"); assertClean("client/handled-catch.ts"); }],
  ["self-referential expectations fail while independent assertions pass", () => { assertHits("client/policy.test.ts", "home(no-self-referential-expectation)"); assertClean("client/policy-clean.test.ts"); }],
  ["imported constant pins are rejected while identity and behavioral assertions pass", () => { assertHits("client/constant-pin.test.ts", "home(no-constant-pin)"); assertClean("client/constant-pin-clean.test.ts"); }],
  ["exploration stories require a default-meta tag only in exploration paths", () => { assertHits("stories/explorations/untagged.stories.tsx", "home(exploration-story-tag)"); assertHits("client/explorations/untagged.stories.tsx", "home(exploration-story-tag)"); assertClean("components/explorations/tagged.stories.tsx"); assertClean("stories/journeys/ordinary.stories.tsx"); }],

  ["instrumentation helpers are isolated unless their boundary is intrinsically safe", () => { assertHits("server/instrumentation-unsafe.ts", "home(isolate-instrumentation-calls)"); assertClean("server/instrumentation-safe.ts"); }],
  ["raw fields have no allowlist in every product layer", () => { assertHits("app/raw.tsx", "home(no-raw-fields)", 2); assertHits("client/raw.tsx", "home(no-raw-fields)", 2); assertHits("components/raw.tsx", "home(no-raw-fields)", 2); }],
  ["raw button allowlist does not grow", () => assertClean("client/landing/supported-globe.tsx")],
  ["detached classes are rejected", () => assertHits("client/detached.tsx", "home(no-detached-class-constants)")],
  ["detached aggregate class maps are rejected without treating mixed data maps as class maps", () => { assertHits("client/detached-aggregate.tsx", "home(no-detached-class-constants)"); assertClean("client/detached-aggregate-clean.tsx"); }],
  ["tests cannot read source", () => assertHits("server/source-read.test.ts", "home(no-source-reads)", 8)],
  ["migration source-read seam is exact", () => { assertHits("tests/helpers/migrations.ts", "home(no-source-reads)", 0); assertHits("tests/helpers/migrations.ts", "home(no-real-waits)"); }],
  ["Apple Pay asset source-read seam is exact", () => { assertHits("tests/well-known/apple-pay-domain-association.test.ts", "home(no-source-reads)", 0); assertHits("tests/well-known/apple-pay-domain-association.test.ts", "home(no-presentation-class-reads)"); }],
  ["test waits are bounded", () => { assertHits("client/waits.test.tsx", "home(no-real-waits)", 4); assertClean("client/waits-clean.test.tsx"); }],
  ["Playwright waits observe behavior instead of sleeping", () => { assertHits("tests/browser/waits.pw.ts", "home(no-real-waits)", 3); assertClean("tests/browser/waits-clean.pw.ts"); }],
  ["Playwright smoke tests exercise a browser rather than request alone", () => { assertHits("tests/browser/request-only.pw.ts", "home(no-request-only-playwright)"); assertClean("tests/browser/request-only-clean.pw.ts"); }],
  ["tests assert behavior rather than classes", () => { assertHits("client/classes.test.tsx", "home(no-presentation-class-reads)", 3); assertClean("client/classes-clean.test.tsx"); }],
  ["computed styles belong only to browser smoke, not component tests or stories", () => { assertHits("client/computed.test.tsx", "home(no-computed-style-in-component-tests)", 3); assertHits("client/computed.stories.tsx", "home(no-computed-style-in-component-tests)"); assertClean("client/computed-clean.test.tsx"); assertClean("client/computed-clean.stories.tsx"); assertClean("tests/browser/computed.pw.ts"); assertClean("client/computed.tsx"); }],
  ["relative Next locations are rejected", () => { assertHits("client/location.tsx", "home(no-relative-location-assignment)", 3); assertClean("client/location-clean.tsx"); }],
  ["anti-slop guardrails stay narrow and active", () => { assertHits("client/anti-slop.ts", "home(no-chained-type-assertions)"); assertHits("client/anti-slop.ts", "home(no-reflect-indirection)", 2); assertHits("client/anti-slop.ts", "home(no-vague-object-parameters)"); assertHits("client/anti-slop.ts", "home(no-unknown-aliases)"); assertHits("client/anti-slop.ts", "home(no-reducer-accumulator-spread)"); assertHits("client/reducer-copy.ts", "home(no-reduce-accumulator-copy)", 2); assertHits("client/widen-then-assert.ts", "home(no-widen-then-assert)"); assertClean("client/reducer-copy-clean.ts"); assertClean("client/reducer-spread-clean.ts"); assertClean("client/widen-then-assert-clean.ts"); }],
  ["mock.module policy rejects unlisted and dynamic modules", () => assertHits("client/mock-rejected.test.tsx", "home(exact-mock-modules)", 2)],
  ["mock.module policy resolves aliased, namespace, immutable, and computed Bun bindings", () => assertHits("client/mock-bindings-rejected.test.tsx", "home(exact-mock-modules)", 4)],
  ["mock.module policy ignores unrelated local lookalikes", () => assertClean("client/mock-unrelated-clean.test.tsx")],
  ["mock.module policy keeps reviewed canonical test and preload paths", () => { assertClean("client/funding/funding-actions.test.tsx"); assertHits("tests/server-only-preload.ts", "home(exact-mock-modules)", 0); }],
  ["Bun test types keep floating mock setup visible to Oxlint", () => assertHits("tests/server-only-preload.ts", "typescript(no-floating-promises)")],
  ["mock.module policy rejects nested suffix collisions", () => assertHits("nested/client/funding/funding-actions.test.tsx", "home(exact-mock-modules)")],
  ["mock.module policy covers test support files without a test suffix", () => assertHits("tests/unreviewed-preload.ts", "home(exact-mock-modules)")],
  ["owned-component rule rejects appearance changes in every product layer", () => { assertHits("app/shadcn.tsx", "home(no-restyle)"); assertHits("client/shadcn.tsx", "home(no-restyle)"); assertHits("components/shadcn.tsx", "home(no-restyle)"); }],
  ["owned-component rule allows layout", () => { assertClean("client/shadcn-clean.tsx"); assertClean("client/shadcn-relative-clean.tsx"); }],
  ["owned-component rule resolves relative UI imports", () => assertHits("client/shadcn-relative.tsx", "home(no-restyle)")],
  ["components/ui owns appearance", () => assertClean("components/ui/restyle-clean.tsx")],
  ["owned-component rule excludes tests and stories", () => { assertClean("client/restyle-clean.test.tsx"); assertClean("client/restyle-clean.stories.tsx"); }],
  ["native TypeScript ownership is active", () => assertHits("client/native.tsx", "typescript(no-explicit-any)")],
  ["native React Hooks ownership is active", () => assertHits("client/native.tsx", "react-hooks(rules-of-hooks)")],
  ["native Next and accessibility ownership is active", () => { assertHits("client/native.tsx", "next(no-img-element)"); assertHits("client/native.tsx", "jsx-a11y(alt-text)"); }],
  ["type-aware pilot owns floating promises in production", () => assertHits("client/type-aware.ts", "typescript(no-floating-promises)")],
  ["type-aware promise misuse is rejected", () => assertHits("client/type-aware-promise.ts", "typescript(no-misused-promises)")],
  ["type-aware switch exhaustiveness is enforced without a default fallback", () => { assertHits("client/type-aware-switch.ts", "typescript(switch-exhaustiveness-check)"); assertClean("client/type-aware-switch-clean.ts"); }],
  ["unknown Tailwind classes are rejected against the live theme", () => { assertHits("client/unknown-class.tsx", "home(no-unknown-tailwind-classes)"); assertClean("client/unknown-class-clean.tsx"); assertClean("client/unknown-class-marker.tsx"); }],
  ["unknown-class coverage follows the production config exclusions", () => assertClean("client/unknown-class.test.tsx")],
  ["raw JSX paint colors are rejected except documented brand assets", () => { assertHits("client/jsx-color.tsx", "home(no-literal-jsx-colors)", 2); assertClean("client/jsx-color-clean.tsx"); assertClean("components/currency-mark.tsx"); assertHits("components/jsx-color-plain.tsx", "home(no-literal-jsx-colors)"); }],
  ["production client rejects unsafe assignment and return with exact rule counts", () => { assertHits("client/unsafe-assignment.ts", "typescript(no-unsafe-assignment)", 1); assertHits("client/unsafe-return.ts", "typescript(no-unsafe-return)", 1); }],
  ["production app and server reject unsafe assignment and return", () => { for (const file of ["app/unsafe-values.ts", "server/unsafe-values.ts"]) { assertHits(file, "typescript(no-unsafe-assignment)", 1); assertHits(file, "typescript(no-unsafe-return)", 1); } }],
  ["production unsafe rules accept typed and parsed unknown values", () => { assertClean("client/unsafe-typed-clean.ts"); assertClean("client/unsafe-boundary-clean.ts"); }],
  ["production unsafe rules exclude test and story fixtures", () => { assertClean("client/unsafe-values.test.ts"); assertClean("client/unsafe-values.stories.tsx"); }],
  ["type-aware SDK boundary rejects unsafe member flow", () => assertHits("server/cdp/sdk-any.ts", "typescript(no-unsafe-member-access)")],
  ["type-aware SDK boundary accepts typed and parsed values", () => { assertClean("server/cdp/sdk-typed-clean.ts"); assertClean("server/cdp/sdk-boundary-clean.ts"); }],
  ["inline request JSON parsing is rejected outside the approved helpers", () => { assertHits("server/request-json-inline.ts", "home(no-inline-request-json)"); assertHits("server/request-json-clean.ts", "home(no-inline-request-json)", 0); assertHits("shared/http/request-json-helper.ts", "home(no-inline-request-json)", 0); assertHits("client/request-json-inline.ts", "home(no-inline-request-json)", 0); }],
  ["manual abort deadlines are rejected outside the shared HTTP helpers and the shrinking baseline", () => { assertHits("server/manual-abort-timeout.ts", "home(no-manual-abort-timeout)"); assertHits("server/manual-abort-timeout-clean.ts", "home(no-manual-abort-timeout)", 0); assertHits("server/http/manual-abort-timeout.ts", "home(no-manual-abort-timeout)", 0); assertHits("server/paymaster/client.ts", "home(no-manual-abort-timeout)", 0); assertHits("client/manual-abort-timeout.ts", "home(no-manual-abort-timeout)", 0); }],
  ["client GETs are rejected while mutations and pass-through transports pass", () => { assertHits("client/fetch-get.ts", "home(no-fetch-in-client-components)"); assertHits("client/fetch-post-clean.ts", "home(no-fetch-in-client-components)", 0); assertHits("client/fetch-passthrough-clean.ts", "home(no-fetch-in-client-components)", 0); assertHits("server/fetch-get.ts", "home(no-fetch-in-client-components)", 0); }],
  ["query keys come from the registered scope factories", () => { assertHits("client/query-key-inline.ts", "home(query-key-factory)"); assertHits("client/query-key-alias.ts", "home(query-key-factory)"); assertHits("client/query-key-factory-clean.ts", "home(query-key-factory)", 0); assertHits("server/query-key-inline.ts", "home(query-key-factory)", 0); }],
  ["handwritten address validators are rejected except the canonical helper and the registered baseline", () => { assertHits("shared/address-literal.ts", "home(no-address-literal-regex)"); assertHits("shared/address-literal-clean.ts", "home(no-address-literal-regex)", 0); assertHits("shared/formatting/address.ts", "home(no-address-literal-regex)", 0); assertHits("shared/address-literal.test.ts", "home(no-address-literal-regex)", 0); }],
  ["every documented production layer is covered by the new rules", () => {
    assertHits("app/request-json-inline.ts", "home(no-inline-request-json)");
    assertHits("server/request-json-inline.ts", "home(no-inline-request-json)");
    assertHits("shared/request-json-inline.ts", "home(no-inline-request-json)");
    assertHits("server/manual-abort-timeout.ts", "home(no-manual-abort-timeout)");
    assertHits("client/fetch-get.ts", "home(no-fetch-in-client-components)");
    assertHits("components/fetch-get.ts", "home(no-fetch-in-client-components)");
    assertHits("client/query-key-inline.ts", "home(query-key-factory)");
    assertHits("components/query-key-inline.ts", "home(query-key-factory)");
    for (const layer of ["app", "client", "components", "config", "server", "shared"]) assertHits(`${layer}/address-literal.ts`, "home(no-address-literal-regex)");
  }],
  ["every documented non-production exclusion is honored by the new rules", () => {
    for (const file of ["server/request-json-inline.test.ts", "shared/request-json-inline.stories.tsx", "shared/request-json-inline.stories.fixture.ts", "shared/request-json-inline.test.variant.ts", "tests/request-json-inline.ts", "shared/testing/request-json-inline.ts", "shared/explorations/request-json-inline.ts", "shared/http/request-json-helper.ts", "client/request-json-inline.ts"]) assertHits(file, "home(no-inline-request-json)", 0);
    for (const file of ["server/request-json-inline-test-harness.ts", "server/testing/request-json-inline.ts"]) assertHits(file, "home(no-inline-request-json)", 0);
    for (const file of ["server/manual-abort-timeout.test.ts", "client/manual-abort-timeout.ts", "server/http/manual-abort-timeout.ts", "server/explorations/manual-abort-timeout.ts", "server/testing/manual-abort-timeout.ts", "server/manual-abort-timeout.stories.tsx", "server/manual-abort-timeout.stories.fixture.ts", "server/manual-abort-timeout.test.variant.ts", "server/manual-abort-timeout-test-harness.ts"]) assertHits(file, "home(no-manual-abort-timeout)", 0);
    for (const file of ["client/fetch-get.test.ts", "client/fetch-get.stories.tsx", "client/explorations/fetch-get.ts", "components/fetch-get.stories.fixture.ts", "server/fetch-get.ts", "client/testing/fetch-get.ts", "client/fetch-get.test.variant.ts", "client/fetch-get.stories.fixture.ts", "client/fetch-get-test-harness.ts"]) assertHits(file, "home(no-fetch-in-client-components)", 0);
    for (const file of ["client/query-key-inline.test.ts", "client/query-key-inline.stories.tsx", "client/explorations/query-key-inline.ts", "server/query-key-inline.ts", "client/testing/query-key-inline.ts", "client/query-key-inline.test.variant.ts", "client/query-key-inline.stories.fixture.ts", "client/query-key-inline-test-harness.ts"]) assertHits(file, "home(query-key-factory)", 0);
    for (const file of ["oxlint/address-literal.ts", "shared/address-literal.stories.tsx", "shared/explorations/address-literal.ts", "server/address-literal.stories.fixture.ts", "client/address-literal.test.variant.ts", "client/address-literal-test-harness.ts"]) assertHits(file, "home(no-address-literal-regex)", 0);
    for (const file of ["server/http/request-json-inline.ts", "server/tests/request-json-inline.ts", "server/request-json-inline-test-harness.probe.ts"]) assertHits(file, "home(no-inline-request-json)", 0);
    assertHits("server/manual-abort-timeout-test-harness.probe.ts", "home(no-manual-abort-timeout)", 0);
    assertHits("server/tests/manual-abort-timeout.ts", "home(no-manual-abort-timeout)", 0);
    for (const file of ["client/tests/fetch-get.ts", "client/fetch-get-test-harness.probe.ts"]) assertHits(file, "home(no-fetch-in-client-components)", 0);
    for (const file of ["client/tests/query-key-inline.ts", "client/query-key-inline-test-harness.probe.ts"]) assertHits(file, "home(query-key-factory)", 0);
    assertHits("shared/tests/address-literal.ts", "home(no-address-literal-regex)", 0);
    for (const file of ["shared/testing/address-literal.ts", "client/address-literal-test-harness.probe.ts"]) assertHits(file, "home(no-address-literal-regex)", 0);
  }],
];

assert.ok(contracts.length > 0, "Oxlint contracts must not be empty");
for (const [name, assertion] of contracts) test(name, assertion);

test("every intended fixture is present in Oxlint's parsed debug file list", () => {
  const intended = Object.keys(fixtures).filter((file) => !ignoredFixturePattern.test(file));
  assert.ok(intended.length > 0, "intended fixtures must not be empty");
  for (const relativePath of intended) {
    assert.ok(listedFiles.has(relativePath), `${relativePath} must appear in Oxlint's debug file list`);
  }
});

test("configured generated paths are absent from Oxlint's parsed debug file list", () => {
  const ignored = Object.keys(fixtures).filter((file) => ignoredFixturePattern.test(file));
  assert.ok(ignored.length > 0, "ignored fixtures must not be empty");
  for (const relativePath of ignored) {
    assert.ok(!listedFiles.has(relativePath), `${relativePath} must stay ignored`);
  }
});
