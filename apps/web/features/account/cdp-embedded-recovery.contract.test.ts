import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { GetUserOperationOptions } from "@coinbase/cdp-core";

const require = createRequire(import.meta.url);
const cdpCoreRoot = dirname(require.resolve("@coinbase/cdp-core/package.json"));

function packageRoot(specifier: string): string {
  return dirname(
    require.resolve(`${specifier}/package.json`, {
      paths: [import.meta.dir, cdpCoreRoot],
    }),
  );
}

function readPackage(specifier: string): { name: string; version: string } {
  return JSON.parse(readFileSync(join(packageRoot(specifier), "package.json"), "utf8")) as {
    name: string;
    version: string;
  };
}

function readPinned(specifier: string, ...segments: string[]): string {
  return readFileSync(join(packageRoot(specifier), ...segments), "utf8");
}

function generatedExportFunction(source: string, exportName: string): string {
  const alias = source.match(
    new RegExp(`\\b([A-Za-z_$][\\w$]*) as ${exportName}\\b`),
  )?.[1];
  if (!alias) throw new Error(`Missing generated export ${exportName}`);

  const start = source.indexOf(`${alias} = (`);
  const end = source.indexOf("\n), ", start);
  if (start < 0 || end < 0) throw new Error(`Missing generated function ${exportName}`);
  return source.slice(start, end + 2);
}

type Assert<T extends true> = T;
type IsRequired<T, Key extends keyof T> = Pick<T, Key> extends Required<Pick<T, Key>>
  ? true
  : false;
type IsAbsent<T, Key extends PropertyKey> = Key extends keyof T ? false : true;

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Unfunded pin-inspection for #175. Passing `X-Idempotency-Key` is wiring
 * evidence only — these tests do not send a user operation or prove replay.
 */
describe("CDP embedded recovery contract (pinned SDK, unfunded)", () => {
  test("pins the frontend packages Home actually calls", () => {
    const webPackage = JSON.parse(
      readFileSync(join(import.meta.dir, "../../package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };
    expect(webPackage.dependencies["@coinbase/cdp-core"]).toBe("0.0.123");
    expect(webPackage.dependencies["@coinbase/cdp-sdk"]).toBe("1.55.0");
    expect(readPackage("@coinbase/cdp-core")).toMatchObject({
      name: "@coinbase/cdp-core",
      version: "0.0.123",
    });
    expect(readPackage("@coinbase/cdp-api-client")).toMatchObject({
      name: "@coinbase/cdp-api-client",
      version: "0.0.123",
    });
    expect(readPackage("@coinbase/cdp-sdk")).toMatchObject({
      name: "@coinbase/cdp-sdk",
      version: "1.55.0",
    });
  });

  test("sendUserOperation forwards the key to one prepare+sign+send endpoint", () => {
    const send = readPinned(
      "@coinbase/cdp-core",
      "dist/web/index.web36.js",
    );
    expect(send).toContain(
      'import { sendUserOperationWithEndUserAccount as o } from "@coinbase/cdp-api-client"',
    );
    expect(send).toMatch(
      /await o\(\s*a\.userId,\s*r\.evmSmartAccount,[\s\S]*\{ projectID: t\(\)\.projectId \},\s*r\.idempotencyKey\s*\)\)\.userOpHash/,
    );
    expect(send).toContain("walletSecretId: m");
    expect(send).not.toContain("prepareUserOperation");
    expect(send).not.toContain("/user-operations/");

    const client = readPinned(
      "@coinbase/cdp-api-client",
      "dist/esm/index8.js",
    );
    const generatedSend = generatedExportFunction(
      client,
      "sendUserOperationWithEndUserAccount",
    );
    expect(generatedSend).toMatch(
      /^[A-Za-z_$][\w$]* = \(t, e, n, a, r\) => d\(\s*\{\s*url: `\/v2\/embedded-wallet-api\/end-users\/\$\{t\}\/evm\/smart-accounts\/\$\{e\}\/send`,\s*method: "POST",[\s\S]*\},\s*r\s*\)$/,
    );

    const transport = readPinned(
      "@coinbase/cdp-api-client",
      "dist/esm/index6.js",
    );
    expect(transport).toContain('"X-Idempotency-Key": a');
    expect(transport).toContain("a && a !== \"\" && (t = D(t, a))");
  });

  test("getUserOperation has no idempotency-key lookup", () => {
    const get = readPinned(
      "@coinbase/cdp-core",
      "dist/web/index.web37.js",
    );
    expect(get).toContain(
      'import { getUserOperationWithEndUserAccount as a } from "@coinbase/cdp-api-client"',
    );
    expect(get).toContain("e.userOperationHash");
    expect(get).not.toContain("idempotencyKey");

    const client = readPinned(
      "@coinbase/cdp-api-client",
      "dist/esm/index8.js",
    );
    expect(client).toContain(
      "url: `/v2/embedded-wallet-api/end-users/${t}/evm/smart-accounts/${e}/user-operations/${n}`",
    );
    expect(client).not.toContain("user-operations?idempotency");

    const lookupTypeContract: [
      Assert<IsRequired<GetUserOperationOptions, "userOperationHash">>,
      Assert<IsAbsent<GetUserOperationOptions, "idempotencyKey">>,
    ] = [true, true];
    expect(lookupTypeContract).toEqual([true, true]);
  });

  test("backend cdp-sdk sendUserOperation applies the key only after prepare", () => {
    const send = readPinned(
      "@coinbase/cdp-sdk",
      "src/actions/evm/sendUserOperation.ts",
    );
    expect(send).toContain("client.prepareUserOperation(");
    const prepareCall = send.slice(
      send.indexOf("client.prepareUserOperation("),
      send.indexOf("const owner ="),
    );
    expect(prepareCall).not.toContain("idempotencyKey");
    expect(send).toContain("client.sendUserOperation(");
    expect(send).toMatch(
      /sendUserOperation\(\s*options\.smartAccount\.address,\s*createOpResponse\.userOpHash as Hex,\s*\{\s*signature,\s*\},\s*options\.idempotencyKey,/,
    );
  });

  test("Home action IDs are UUID v4, matching the documented key format", () => {
    const issue = readFileSync(
      join(import.meta.dir, "../../server/money-actions/issue.ts"),
      "utf8",
    );
    expect(issue).toContain("id: options.actionId ?? randomUUID()");
    expect(issue).toContain(
      "/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i",
    );
    expect("11111111-1111-4111-8111-111111111111").toMatch(UUID_V4);
    expect("not-a-uuid").not.toMatch(UUID_V4);
  });

  test("Home passes the action id as idempotencyKey and treats send throws as unknown", () => {
    const client = readFileSync(
      join(import.meta.dir, "cdp-client.tsx"),
      "utf8",
    );
    const embeddedSendStart = client.indexOf(
      "const submission = await sdkSendUserOperation({",
    );
    const embeddedSendEnd = client.indexOf(
      "const retained = providerHandleJournal.retain(providerHandleBinding, {",
      embeddedSendStart,
    );
    const embeddedPersist = client.indexOf(
      "await providerHandleJournal.persist(retained.entry!);",
      embeddedSendEnd,
    );
    const embeddedUpload = client.indexOf(
      "const journaled = await recoverJournaledProviderHandle({",
      embeddedPersist,
    );
    expect(embeddedSendStart).toBeGreaterThanOrEqual(0);
    expect(embeddedSendEnd).toBeGreaterThan(embeddedSendStart);
    expect(embeddedPersist).toBeGreaterThan(embeddedSendEnd);
    expect(embeddedUpload).toBeGreaterThan(embeddedPersist);

    const embeddedSend = client.slice(embeddedSendStart, embeddedSendEnd);
    expect(embeddedSend).toContain("idempotencyKey: canonicalAction.id");
    expect(embeddedSend).toContain(
      'recordMoneyActionStatus(fetchMoneyActionApi, canonicalAction.id, "unknown")',
    );
    expect(embeddedSend).toContain(
      'throw new TransferExecutionError("submission-unknown", error)',
    );
  });

  test("SDK error types distinguish documented idempotency codes from transport unknowns", () => {
    const types = readPinned("@coinbase/cdp-api-client", "dist/types/index.d.ts");
    for (const code of [
      "idempotency_error",
      "already_exists",
      "invalid_request",
      "unauthorized",
      "not_found",
      "timed_out",
      "internal_server_error",
    ]) {
      expect(types).toContain(`readonly ${code}: "${code}"`);
    }
    for (const code of [
      "unknown",
      "bad_gateway",
      "service_unavailable",
      "unexpected_error",
    ]) {
      expect(types).toContain(`readonly ${code}: "${code}"`);
    }

    const transport = readPinned(
      "@coinbase/cdp-api-client",
      "dist/esm/index6.js",
    );
    expect(transport).toContain("!e.response");
    expect(transport).toContain("new U(");
    expect(transport).toContain("m.unknown");
  });
});
