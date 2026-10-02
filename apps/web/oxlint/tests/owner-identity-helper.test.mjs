import { afterAll, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("../..", import.meta.url));
const mirror = await mkdtemp(path.join(tmpdir(), "home-owner-identity-"));
await cp(path.join(web, "oxlint"), path.join(mirror, "oxlint"), { recursive: true });
await cp(path.join(web, ".oxlintrc.jsonc"), path.join(mirror, ".oxlintrc.jsonc"));
await symlink(path.join(web, "node_modules"), path.join(mirror, "node_modules"), "dir");
afterAll(() => rm(mirror, { recursive: true, force: true }));

let batch = 0;
async function lintAll(fixtures) {
  batch += 1;
  const files = fixtures.map((fixture, index) => fixture.file ?? `client/fixture-${batch}-${index}.tsx`);
  await Promise.all(files.map(async (file, index) => {
    await mkdir(path.dirname(path.join(mirror, file)), { recursive: true });
    await writeFile(path.join(mirror, file), fixtures[index].code);
  }));
  const result = spawnSync(path.join(web, "node_modules", ".bin", "oxlint"),
    ["-c", ".oxlintrc.jsonc", "--disable-nested-config", "-f", "json", ...files],
    { cwd: mirror, encoding: "utf8" });
  expect(result.signal).toBeNull();
  expect([0, 1]).toContain(result.status);
  const report = JSON.parse(result.stdout);
  expect(report.number_of_files, `oxlint linted ${report.number_of_files} of ${files.length} fixtures`).toBe(files.length);
  const diagnostics = report.diagnostics
    .filter((entry) => entry.code === "home(owner-identity-helper)");
  return files.map((file) => diagnostics.filter((entry) => entry.filename === file).length);
}

test("rejects owner tuples in templates, concatenation, and inline or const-bound array joins", async () => {
  const counts = await lintAll([
    "const identity = `${session.user.subject}:${session.smartAccount.address}`;",
    "const identity = `${subject}\\u0000${chainId}`;",
    "const identity = session.user.subject + ':' + session.smartAccount.address;",
    "const identity = session.user.subject + ':' + session.smartAccountAddress;",
    "const identity = session.user.subject.concat(':', session.smartAccount.address);",
    "const identity = session.user.subject.concat(':', session.smartAccountAddress);",
    "const identity = [session.user.subject, session.smartAccountAddress].join(':');",
    "const identity = [wallet.ownerKey, session.user.subject].join('\\u0000');",
    "const identity = [session.user.subject, session.smartAccount.address].map(String).join(':');",
    "const identity = [session.user.subject, session.smartAccount.address].map(String).map(String).join(':');",
    "const parts = [session.user.subject, session.smartAccount.address].map(String); const identity = parts.join(':');",
    "const parts = [session.user.subject, session.smartAccount.address].map(String).map(String); const identity = parts.join(':');",
    "const parts = [session.user.subject, session.smartAccount.address]; const identity = parts.join(':');",
    "function identity(session) { const parts = [session.user.subject, session.smartAccount.address]; return parts.join(':'); }",
    "const identity = `${session.user.subject}:${session.smartAccount!.address}`;",
    "const identity = `${session.user.subject}:${session.smartAccount?.address}`;",
    "const identity = `${session!.user.subject}:${session.smartAccount!.address}`;",
    "const identity = `${session.user.subject as string}:${session.smartAccount!.address as string}`;",
    "const identity = session.user.subject + ':' + session.smartAccount!.address;",
    "const parts = [session.user.subject, session.smartAccount!.address] as const; const identity = parts.join(':');",
    "const identity = ([session.user.subject, session.smartAccountAddress] as string[]).join(':');",
    "const identity = ([session.user.subject, session.smartAccount.address] as const).map(String).join(':');",
    "const currentSession = session; const identity = `${currentSession.user.subject}:${currentSession.smartAccount.address}`;",
    "const first = session; const second = first; const identity = `${second.user.subject}:${second.smartAccount.address}`;",
    "const currentSession = wallet.session; const identity = `${currentSession.user.subject}:${currentSession.smartAccount.address}`;",
    "const currentSession = session; const identity = currentSession.user.subject + ':' + currentSession.smartAccount.address;",
    "const currentSession = session; const identity = currentSession.user.subject.concat(':', currentSession.smartAccount.address);",
    "const currentSession = session; const identity = [currentSession.user.subject, currentSession.smartAccount.address].join(':');",
    "const identity = `${props.session.user.subject}:${props.session.smartAccount.address}`;",
    "const identity = `${props.session.user.subject}:${props.session.smartAccount?.address}`;",
    "function key(props) { return `${props.session.user.subject}:${props.session.smartAccount!.address}`; }",
    "const identity = `${input.session.user.subject}:${input.session.smartAccountAddress}`;",
    "const identity = `${resetKey}:${props.session.user.subject}:${props.session.smartAccount?.address ?? ''}:${props.session.accountProvider}:${props.token.assetId}`;",
    "const currentSession = props.session; const identity = `${currentSession.user.subject}:${currentSession.smartAccount.address}`;",
    "const identity = [props.session.user.subject, props.session.smartAccount.address].join(':');",
  ].map((code) => ({ code })));
  for (const [index, count] of counts.entries()) expect(count, `fixture ${index} was not reported`).toBe(1);
}, 15_000);

test("permits isolated parts and unrelated subjects", async () => {
  const counts = await lintAll([
    "const identity = `${session.user.subject}`;",
    "const identity = `${session.smartAccount.address}`;",
    "const label = `${message.subject}:${message.port}`;",
    "const identity = ([session.user.subject] as const).join(':');",
    "const label = `${message.subject}:${message.address}`;",
    "const label = message.subject + message.address;",
    "const identity = session.user.subject.concat(':');",
    "const label = message.subject + message.label;",
    "const card = subject === 'card' ? 'feature-intro' : 'other';",
    "const parts = [session.user.subject, 'cash']; const identity = parts.join(':');",
    "const identity = `${session.smartAccount!.address}`;",
    "const identity = `${session.user!.subject}`;",
    "const card = message; const label = `${card.subject}:${card.port}`;",
    "const currentSession = session; function other() { const currentSession = message; return `${currentSession.subject}:${currentSession.address}`; }",
    "let currentSession = session; currentSession = message; const label = `${currentSession.subject}:${currentSession.address}`;",
    "const session = { message: { subject: 'mail', address: 'street' } }; const { message: card } = session; const label = `${card.subject}:${card.address}`;",
    "const label = `${payload.subject}:${payload.address}`;",
    "const label = `${theme.rows.subject}:${theme.rows.address}`;",
  ].map((code) => ({ code })));
  for (const [index, count] of counts.entries()) expect(count, `fixture ${index} was reported`).toBe(0);
});

test("exempts owner identity construction in the centralized helper", async () => {
  const [exempted] = await lintAll([{
    code: "const identity = `${session.user.subject}:${session.smartAccount.address}`;",
    file: "client/account/owner-keys.ts",
  }]);
  expect(exempted).toBe(0);
});

test("respects a const receiver shadowed in an inner scope", async () => {
  const [shadowed] = await lintAll([{
    code: "const parts = [session.user.subject, session.smartAccount.address]; function other() { const parts = ['cash']; return parts.join(':'); }",
  }]);
  expect(shadowed).toBe(0);
});
