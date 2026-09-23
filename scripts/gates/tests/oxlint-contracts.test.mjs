import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

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
await symlink(path.join(appsWebDir, "node_modules"), path.join(mirror, "node_modules"), "dir");
await symlink(path.join(appsWebDir, "components.json"), path.join(mirror, "components.json"));
await symlink(path.join(appsWebDir, "tsconfig.json"), path.join(mirror, "tsconfig.json"));
await mkdir(path.join(mirror, "app"), { recursive: true });
await symlink(path.join(appsWebDir, "app/globals.css"), path.join(mirror, "app/globals.css"));
await mkdir(path.join(mirror, "components/ui"), { recursive: true });
await symlink(path.join(appsWebDir, "components/ui/button.tsx"), path.join(mirror, "components/ui/button.tsx"));

const fixtures = {
  "app/comment.mjs": "export const value = 1; // unexplained",
  "client/comment.ts": "export const value = 1; /* narrative */",
  "components/comment.jsx": "export const value = 1; // narrative",
  "server/comment.ts": "import \"server-only\"; export const value = 1; // narrative",
  "shared/comment.tsx": "export const value = 1; /* narrative */",
  "shared/comment-clean.ts": ["/** @public Shared contract for external consumers. */", "export const value = 1;"].join(String.fromCharCode(10)),
  "client/comment-clean.test.ts": ["// test code is excluded", "export const value = 1;"].join(String.fromCharCode(10)),
  "client/comment-clean.stories.tsx": ["// story code is excluded", "export const value = 1;"].join(String.fromCharCode(10)),
  "client/storybook.tsx": 'import x from "@storybook/test"; export { x }; export * from "msw"; const a = import(`storybook`); const b = require("msw/browser"); export { a, b };',
  "config/storybook.ts": 'export { setupWorker } from "msw/browser";',
  "types/storybook.d.ts": 'import type { Meta } from "@storybook/nextjs-vite"; export type M = Meta;',
  "client/layers.ts": 'import a from "@/server/a"; export { b } from "../server/b"; const c = import(`@/server/c`); const d = require(`../server/d`); export { a, c, d };',
  "server/layers.ts": 'import "server-only"; import a from "@/client/a"; const b = import(`../components/b`); const c = require("@/app/c"); export { a, b, c };',
  "shared/layers.ts": 'import React from "react"; export * from "node:fs"; const a = import(`@/client/a`); const b = require("../server/b"); export { React, a, b };',
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
  "app/raw.tsx": 'export function A(){ return <><button>go</button><input/><select/></> }',
  "app/silent-catch.ts": 'try { run(); } catch {}',
  "app/handled-catch.ts": 'export function read(){ try { return run(); } catch { return { ok: false }; } }',
  "client/silent-catch.ts": 'export function read(){ try { run(); } catch {} }',
  "client/handled-catch.ts": 'function unsupported(): never { throw new Error("unsupported"); } export function read(){ try { run(); } catch { unsupported(); } }',
  "server/silent-catch.ts": 'import "server-only"; export function read(){ try { run(); } catch {} }',
  "client/policy.ts": 'export const policy = "frame-ancestors none"; export const readHeader = () => "frame-ancestors none";',
  "client/policy.test.ts": 'import { expect, test } from "bun:test"; import { policy } from "./policy"; test("x", () => { expect(readHeader()).toBe(policy); });',
  "client/policy-clean.test.ts": 'import { expect, test } from "bun:test"; import { policy, readHeader } from "./policy"; test("x", () => { expect(readHeader()).toBe("frame-ancestors none"); expect(policy).toBe("frame-ancestors none"); });',

  "client/raw.tsx": 'export function A(){ return <><button>go</button><input/><select/></> }',
  "components/raw.tsx": 'export function A(){ return <><button>go</button><input/><select/></> }',
  "client/landing/supported-globe.tsx": 'export function A(){ return <button>go</button> }',
  "client/detached.tsx": 'const tone="text-primary"; export function A(){ return <div className={tone}/> }',
  "client/detached-aggregate.tsx": 'const styles={active:"text-primary",idle:"text-muted-foreground"}; export function A({state}:{state:string}){ return <div className={styles[state]}/> }',
  "client/detached-aggregate-clean.tsx": 'const data={active:"text-primary",count:2}; export function A({state}:{state:string}){ return <div className={data[state]}/> }',
  "server/source-read.test.ts": 'import x from "fs"; export { y } from "node:fs/promises"; export * from "fs/promises"; const a=import("node:fs"); const b=import(`fs/promises`); const c=require("fs"); const d=require(`node:fs`); const e=Bun.file("x"); export {x,a,b,c,d,e};',
  "tests/helpers/migrations.ts": 'import { readFile } from "node:fs/promises"; Bun.sleep(1); export { readFile };',
  "tests/well-known/apple-pay-domain-association.test.ts": 'import { readFile } from "node:fs/promises"; export function x(e: Element){ return [readFile, e.className] }',
  "client/waits.test.tsx": 'setTimeout(()=>{},51); setInterval(()=>{},52); Bun.sleep(1); waitFor(()=>{}, {timeout:2001});',
  "client/waits-clean.test.tsx": 'setTimeout(()=>{},50); setInterval(()=>{},50); waitFor(()=>{}, {timeout:2000});',
  "tests/browser/waits.pw.ts": 'page.waitForTimeout(1); frame.waitForTimeout(1); new Promise(resolve=>setTimeout(resolve, delay));',
  "tests/browser/waits-clean.pw.ts": 'await expect.poll(readStatus).toBe("ready"); await page.getByRole("button").waitFor();',
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
  "client/reducer-spread-clean.ts": 'export const a=["x"].reduce((all,item)=>({...item}),{}); const defaults={x:1}; export const b=["x"].reduce((all,item)=>({...defaults,[item]:1}),{}); export const c=[["x"]].reduce((all,item)=>([...item]),[]);',
  "client/widen-then-assert.ts": 'const source={id:"x"};const erased:unknown=source;export const value=(erased) as {id:string};',
  "client/widen-then-assert-clean.ts": 'declare const input:unknown;export const parsed=input as {id:string};const byRuntimeKey:Record<string,{id:string}>={};byRuntimeKey[parsed.id]=parsed;const fixture:Record<string,string>[]=[];fixture.push({id:parsed.id});',
  "client/mock-rejected.test.tsx": 'import { mock } from "bun:test"; const name="x"; mock.module("other",()=>({})); mock.module(name,()=>({}));',
  "client/mock-bindings-rejected.test.tsx": 'import { mock as bunMock } from "bun:test"; import * as bunTest from "bun:test"; const alias=bunMock; bunMock.module("other",()=>({})); bunTest.mock.module("other",()=>({})); alias.module("other",()=>({})); bunMock["module"]("other",()=>({}));',
  "client/mock-unrelated-clean.test.tsx": 'const mock={module(_name:string,_factory:()=>object){}}; const bunTest={mock}; mock.module("other",()=>({})); bunTest.mock["module"]("other",()=>({}));',
  "client/funding/funding-actions.test.tsx": 'import { mock } from "bun:test"; mock.module("next/navigation",()=>({}));',
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
  "server/cdp/sdk-any.ts": 'import "server-only"; declare function readSdk(): any; export const address = readSdk().address;',
  "server/cdp/sdk-typed-clean.ts": 'import "server-only"; declare function readSdk(): { address: string }; export const address = readSdk().address;',
  "server/cdp/sdk-boundary-clean.ts": 'import "server-only"; declare const value: unknown; export function address(){ if (!value || typeof value !== "object" || !("address" in value)) return null; return value.address; }',
  "node_modules/ignored.ts": 'const x: any = 1;',
  ".next/ignored.ts": 'const x: any = 1;',
  "storybook-static/ignored.ts": 'const x: any = 1;'
};

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

const debug = spawnSync(binary, ["-c", ".oxlintrc.jsonc", "--disable-nested-config", "--debug", "files", "."], { cwd: mirror, encoding: "utf8" });
assert.equal(debug.status, 0, debug.stderr);
const listedFiles = new Set(`${debug.stdout}\n${debug.stderr}`
  .split(/\r?\n/)
  .map((line) => line.trim().replace(/^\.\//, ""))
  .filter(Boolean));
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
  ["client layer aliases and relative paths are fenced", () => assertHits("client/layers.ts", "home(no-client-server-imports)", 4)],
  ["server layer aliases and relative paths are fenced", () => assertHits("server/layers.ts", "home(no-server-client-imports)", 3)],
  ["shared stays runtime agnostic", () => assertHits("shared/layers.ts", "home(no-shared-runtime-imports)", 4)],
  ["browser SDKs stay in the account owner fence", () => { assertHits("app/sdk.ts", "home(no-browser-sdk-imports)"); assertHits("client/sdk.ts", "home(no-browser-sdk-imports)"); assertHits("components/sdk.ts", "home(no-browser-sdk-imports)"); assertHits("shared/sdk.ts", "home(no-browser-sdk-imports)"); assertClean("client/account/sdk.tsx"); }],
  ["base-ui primitives stay in owned wrappers", () => { assertHits("app/base-ui.tsx", "home(no-base-ui-imports)"); assertHits("client/base-ui.tsx", "home(no-base-ui-imports)"); assertHits("components/base-ui.tsx", "home(no-base-ui-imports)"); assertHits("server/base-ui.ts", "home(no-base-ui-imports)"); assertHits("shared/base-ui.ts", "home(no-base-ui-imports)"); }],
  ["server marker is first", () => { assertHits("server/no-marker.ts", "home(require-server-only)"); assertHits("server/late-marker.ts", "home(require-server-only)"); assertClean("server/clean.ts"); }],
  ["formatting is centralized", () => { assertHits("client/format.tsx", "home(no-local-formatting)", 6); assertClean("shared/formatting/clean.ts"); }],
  ["money amounts preserve unavailable state instead of defaulting to zero", () => { assertHits("shared/formatting/amount-fallback.ts", "home(no-amount-fallback)", 3); assertClean("shared/formatting/amount-fallback-clean.ts"); }],
  ["literal utility styles reject all supported expression forms", () => { assertHits("client/styles.tsx", "home(no-literal-utility-styles)", 4); assertClean("client/styles-clean.tsx"); }],
  ["raw controls use owned wrappers in every product layer", () => { assertHits("app/raw.tsx", "home(no-raw-buttons)"); assertHits("client/raw.tsx", "home(no-raw-buttons)"); assertHits("components/raw.tsx", "home(no-raw-buttons)"); }],
  ["product comments are rejected in all five layers while documented exceptions and tests stay clean", () => { for (const file of ["app/comment.mjs", "client/comment.ts", "components/comment.jsx", "server/comment.ts", "shared/comment.tsx"]) assertHits(file, "home(no-comments)"); assertClean("shared/comment-clean.ts"); assertClean("client/comment-clean.test.ts"); assertClean("client/comment-clean.stories.tsx"); }],
  ["silent catches fail while typed recovery values pass in every covered layer", () => { assertHits("app/silent-catch.ts", "home(no-silent-catch)"); assertHits("client/silent-catch.ts", "home(no-silent-catch)"); assertHits("server/silent-catch.ts", "home(no-silent-catch)"); assertClean("app/handled-catch.ts"); assertClean("client/handled-catch.ts"); }],
  ["self-referential expectations fail while independent assertions pass", () => { assertHits("client/policy.test.ts", "home(no-self-referential-expectation)"); assertClean("client/policy-clean.test.ts"); }],

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
  ["tests assert behavior rather than classes", () => { assertHits("client/classes.test.tsx", "home(no-presentation-class-reads)", 3); assertClean("client/classes-clean.test.tsx"); }],
  ["computed styles belong only to browser smoke, not component tests or stories", () => { assertHits("client/computed.test.tsx", "home(no-computed-style-in-component-tests)", 3); assertHits("client/computed.stories.tsx", "home(no-computed-style-in-component-tests)"); assertClean("client/computed-clean.test.tsx"); assertClean("client/computed-clean.stories.tsx"); assertClean("tests/browser/computed.pw.ts"); assertClean("client/computed.tsx"); }],
  ["relative Next locations are rejected", () => { assertHits("client/location.tsx", "home(no-relative-location-assignment)", 3); assertClean("client/location-clean.tsx"); }],
  ["anti-slop guardrails stay narrow and active", () => { assertHits("client/anti-slop.ts", "home(no-chained-type-assertions)"); assertHits("client/anti-slop.ts", "home(no-reflect-indirection)", 2); assertHits("client/anti-slop.ts", "home(no-vague-object-parameters)"); assertHits("client/anti-slop.ts", "home(no-unknown-aliases)"); assertHits("client/anti-slop.ts", "home(no-reducer-accumulator-spread)"); assertHits("client/reducer-copy.ts", "home(no-reduce-accumulator-copy)", 2); assertHits("client/widen-then-assert.ts", "home(no-widen-then-assert)"); assertClean("client/reducer-copy-clean.ts"); assertClean("client/reducer-spread-clean.ts"); assertClean("client/widen-then-assert-clean.ts"); }],
  ["mock.module policy rejects unlisted and dynamic modules", () => assertHits("client/mock-rejected.test.tsx", "home(exact-mock-modules)", 2)],
  ["mock.module policy resolves aliased, namespace, immutable, and computed Bun bindings", () => assertHits("client/mock-bindings-rejected.test.tsx", "home(exact-mock-modules)", 4)],
  ["mock.module policy ignores unrelated local lookalikes", () => assertClean("client/mock-unrelated-clean.test.tsx")],
  ["mock.module policy keeps reviewed canonical test and preload paths", () => { assertClean("client/funding/funding-actions.test.tsx"); assertClean("tests/server-only-preload.ts"); }],
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
  ["type-aware SDK boundary rejects unsafe member flow", () => assertHits("server/cdp/sdk-any.ts", "typescript(no-unsafe-member-access)")],
  ["type-aware SDK boundary accepts typed and parsed values", () => { assertClean("server/cdp/sdk-typed-clean.ts"); assertClean("server/cdp/sdk-boundary-clean.ts"); }],
];

for (const [name, assertion] of contracts) test(name, assertion);

test("every intended fixture is present in Oxlint's parsed debug file list", () => {
  for (const relativePath of Object.keys(fixtures).filter((file) => !ignoredFixturePattern.test(file))) {
    assert.ok(listedFiles.has(relativePath), `${relativePath} must appear in Oxlint's debug file list`);
  }
});

test("configured generated paths are absent from Oxlint's parsed debug file list", () => {
  for (const relativePath of Object.keys(fixtures).filter((file) => ignoredFixturePattern.test(file))) {
    assert.ok(!listedFiles.has(relativePath), `${relativePath} must stay ignored`);
  }
});
