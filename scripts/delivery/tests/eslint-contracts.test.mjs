import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Canaries for the ESLint contract rules in apps/web/eslint.config.mjs. They run
// the installed flat config through the ESLint API with in-memory sources at
// representative file paths, so removing or replacing a rule while editing the
// config fails here even though real sources may be clean (the 17942b04 drift).
//
// Fixtures execute with apps/web as process.cwd: the import plugin's resolver
// (basePath ".") resolves against the process cwd, not the ESLint cwd option, and
// node --test isolates the chdir to this file's process. That keeps static
// relative imports resolvable, so import/no-restricted-paths is asserted here
// alongside the alias, dynamic-import, syntax, and plugin rules.

const appsWebDir = fileURLToPath(new URL("../../../apps/web", import.meta.url));

process.chdir(appsWebDir);

const { ESLint } = createRequire(`${appsWebDir}/package.json`)("eslint");

const eslint = new ESLint({ cwd: appsWebDir });

// Lint in-memory source as if it lived at apps/web/<filePath> and return all
// messages, failing loudly on parse faults.
async function lintMessages(filePath, code) {
  const results = await eslint.lintText(code, { filePath: `${appsWebDir}/${filePath}` });
  const messages = results.flatMap((result) => result.messages);
  const fatal = messages.filter((message) => message.fatal);
  assert.deepEqual(fatal, [], `fixture ${filePath} failed to parse`);
  return messages;
}

async function lintErrors(filePath, code) {
  return (await lintMessages(filePath, code)).filter((message) => message.severity === 2);
}

// Failing canary: expect exactly one message from the pinned ruleId matching the
// pinned message fragment, so replacing the rule's identity fails the canary.
async function assertRestricted(filePath, code, ruleId, messagePart) {
  const errors = await lintErrors(filePath, code);
  const hits = errors.filter(
    (message) => message.ruleId === ruleId && message.message.includes(messagePart),
  );
  assert.equal(
    hits.length,
    1,
    `expected ${ruleId} (${messagePart}) to report in ${filePath}; got ${JSON.stringify(errors)}`,
  );
}

// Passing control: expect no error-severity messages and no ignored/no-config
// notice (ruleId null), so a fixture the config stopped covering cannot pass
// vacuously.
async function assertClean(filePath, code) {
  const messages = await lintMessages(filePath, code);
  const notices = messages.filter((message) => message.ruleId === null);
  assert.deepEqual(
    notices,
    [],
    `fixture ${filePath} must be covered by the config (ignored/no-config notice makes this control vacuous); got ${JSON.stringify(notices)}`,
  );
  const errors = messages.filter((message) => message.severity === 2);
  assert.deepEqual(errors, [], `expected ${filePath} to be clean; got ${JSON.stringify(errors)}`);
}

test("shadcn/no-restyle reports owned-component restyling in client code", async () => {
  await assertRestricted(
    "client/gates-fixture.tsx",
    'import { Button } from "@/components/ui/button";\nexport function A() { return <Button className="rounded-full">x</Button>;\n}\n',
    "shadcn/no-restyle",
    "rounded-full",
  );
});

test("shadcn/no-restyle allows layout classes and components/ui ownership", async () => {
  await assertClean(
    "client/gates-fixture.tsx",
    'import { Button } from "@/components/ui/button";\nexport function A() { return <Button className="w-full">x</Button>;\n}\n',
  );
  // components/ui wrappers own their restyling by contract.
  await assertClean(
    "components/ui/gates-fixture.tsx",
    'import { Button } from "@/components/ui/button";\nexport function A() { return <Button className="rounded-full">x</Button>;\n}\n',
  );
});

test("client modules must not import the server layer", async () => {
  await assertRestricted(
    "client/gates-fixture.tsx",
    'import { x } from "@/server/anything";\nexport const y = x;\n',
    "no-restricted-imports",
    "client modules must not import the server layer",
  );
});

test("client modules must not import the server layer by relative path", async () => {
  // import/no-restricted-paths only reports resolvable imports, so the fixture
  // pins a real server module.
  await assertRestricted(
    "client/gates-fixture.tsx",
    'import { migrationGateDecision } from "../server/db/migration-gate";\nexport const y = migrationGateDecision;\n',
    "import/no-restricted-paths",
    "client modules must not import the server layer",
  );
});

test("client modules must not dynamically import the server layer", async () => {
  await assertRestricted(
    "client/gates-fixture.tsx",
    'export async function f() { return import("@/server/anything"); }\n',
    "no-restricted-syntax",
    "client modules must not import the server layer",
  );
});

test("server modules must not import web client layers", async () => {
  await assertRestricted(
    "server/gates-fixture.ts",
    'import "server-only";\nimport { a } from "@/client/anything";\nexport const y = a;\n',
    "no-restricted-imports",
    "server modules must not import web client or app layers",
  );
  await assertRestricted(
    "server/gates-fixture.ts",
    'import "server-only";\nexport async function f() { return import("@/client/anything"); }\n',
    "no-restricted-syntax",
    "server modules must not import web client or app layers",
  );
});

test("browser wallet SDKs stay out of generic client code", async () => {
  await assertRestricted(
    "client/gates-fixture.tsx",
    'import { foo } from "@coinbase/cdp-sdk";\nexport const y = foo;\n',
    "no-restricted-imports",
    "browser wallet provider SDKs belong behind the client/account owner-generation fence",
  );
});

test("client/account is the intentional browser SDK fence", async () => {
  await assertClean(
    "client/account/gates-fixture.tsx",
    'import { foo } from "@coinbase/cdp-sdk";\nexport const y = foo;\n',
  );
  // The fence exception does not reopen the server layer.
  await assertRestricted(
    "client/account/gates-fixture.tsx",
    'import { x } from "@/server/anything";\nexport const y = x;\n',
    "no-restricted-imports",
    "client modules must not import the server layer",
  );
});

test("shared modules must not import react, next, or node builtins", async () => {
  await assertRestricted(
    "shared/gates-fixture.ts",
    'import { useState } from "react";\nexport const y = useState;\n',
    "no-restricted-imports",
    "shared modules must remain runtime-agnostic",
  );
  await assertRestricted(
    "shared/gates-fixture.ts",
    'import Link from "next/link";\nexport const y = Link;\n',
    "no-restricted-imports",
    "shared modules must remain runtime-agnostic",
  );
  await assertRestricted(
    "shared/gates-fixture.ts",
    'import { readFileSync } from "node:fs";\nexport const y = readFileSync;\n',
    "no-restricted-imports",
    "shared modules must remain runtime-agnostic",
  );
  await assertRestricted(
    "shared/gates-fixture.ts",
    'export async function f() { return import("node:fs"); }\n',
    "no-restricted-syntax",
    "shared modules must remain runtime-agnostic",
  );
});

test("shared modules stay runtime-agnostic with platform libraries", async () => {
  await assertClean(
    "shared/gates-fixture.ts",
    'import { formatUnits } from "viem";\nexport function f(v: bigint) { return formatUnits(v, 18); }\n',
  );
});

test("server modules must start with the server-only import", async () => {
  await assertRestricted(
    "server/gates-fixture.ts",
    'export const y = 1;\n',
    "server-only/require-server-only",
    "",
  );
  await assertClean("server/gates-fixture.ts", 'import "server-only";\nexport const y = 1;\n');
  // Test files are intentionally exempt from the server-only marker.
  await assertClean("server/gates-fixture.test.ts", 'export const y = 1;\n');
});

test("raw buttons and fields are rejected outside owned wrappers", async () => {
  await assertRestricted(
    "client/gates-fixture.tsx",
    'export function A() { return <button type="button">go</button>;\n}\n',
    "no-restricted-syntax",
    "Use Button from @/components/ui/button",
  );
  await assertRestricted(
    "client/gates-fixture.tsx",
    'export function A() { return <input value="x" onChange={() => {}} />;\n}\n',
    "no-restricted-syntax",
    "Use Input or Select from @/components/ui",
  );
  await assertClean(
    "client/gates-fixture.tsx",
    'import { Button } from "@/components/ui/button";\nexport function A() { return <Button type="button">go</Button>;\n}\n',
  );
});

test("the raw-button allowlist file keeps its intentional exception", async () => {
  await assertClean(
    "client/landing/supported-globe.tsx",
    'export function A() { return <button type="button">go</button>;\n}\n',
  );
});

test("literal styles in utility classes are rejected", async () => {
  const messagePart = "Use semantic theme tokens";
  await assertRestricted(
    "client/gates-fixture.tsx",
    'export function A() { return <div className="bg-[#123456]">x</div>;\n}\n',
    "no-restricted-syntax",
    messagePart,
  );
  await assertRestricted(
    "client/gates-fixture.tsx",
    'export function A() { return <div className="text-blue-500">x</div>;\n}\n',
    "no-restricted-syntax",
    messagePart,
  );
  await assertRestricted(
    "client/gates-fixture.tsx",
    'export function A() { return <div className="p-[7px]">x</div>;\n}\n',
    "no-restricted-syntax",
    messagePart,
  );
});

test("var-based arbitrary values are the intentional literal-style exception", async () => {
  await assertClean(
    "client/gates-fixture.tsx",
    'export function A() { return <div className="w-[var(--gate-width)]">x</div>;\n}\n',
  );
});

test("shared presentation formatting must use shared/formatting", async () => {
  await assertRestricted(
    "shared/gates-fixture.ts",
    'export function f(n: number) { return n.toFixed(2); }\n',
    "no-restricted-syntax",
    "Use shared/formatting for numeric presentation.",
  );
});

test("shared/formatting is the intentional presentation-formatting exception", async () => {
  await assertClean(
    "shared/formatting/gates-fixture.ts",
    'export function f(n: number) { return n.toFixed(2); }\n',
  );
});
