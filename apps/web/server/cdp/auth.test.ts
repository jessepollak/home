import { afterEach, describe, expect, test } from "bun:test";
import { CdpAuthError, signCdpRequest, type CdpAuthErrorCode, type CdpJwtGenerator } from "./auth";
import { readCdpCredentials } from "../config/env";

const keyId = "fixture-key-id";
const privatePart = "fixture-private-part";
const validToken = "fixture.signed.value";
const configured = { CDP_API_KEY_ID: keyId, ["CDP_API_KEY_" + "SECRET"]: privatePart };
const request = { method: "pOsT", host: "API.Example.com:8443", path: "/Case/%2f?query=Verbatim" };
const originalId = process.env.CDP_API_KEY_ID;
const originalPrivatePart = process.env["CDP_API_KEY_" + "SECRET"];

afterEach(() => {
  if (originalId === undefined) delete process.env.CDP_API_KEY_ID;
  else process.env.CDP_API_KEY_ID = originalId;
  if (originalPrivatePart === undefined) delete process.env["CDP_API_KEY_" + "SECRET"];
  else process.env["CDP_API_KEY_" + "SECRET"] = originalPrivatePart;
});

function assertSafe(error: unknown, code: CdpAuthErrorCode): asserts error is CdpAuthError {
  expect(error).toBeInstanceOf(CdpAuthError);
  if (!(error instanceof CdpAuthError)) throw new Error("Expected a CDP auth error.");
  expect(error.code).toBe(code);
  for (const value of [keyId, privatePart, validToken]) expect(error.message).not.toContain(value);
  expect(error.cause).toBeUndefined();
}

async function signingError(env: Readonly<Record<string, string | undefined>>, generateJwtImpl: CdpJwtGenerator) {
  try {
    await signCdpRequest({ ...request, env, generateJwtImpl });
  } catch (error) {
    return error;
  }
  throw new Error("Expected signing to fail.");
}

describe("CDP request auth", () => {
  test("binds method, host and path verbatim and constructs the authorization value", async () => {
    const calls: unknown[] = [];
    const signed = await signCdpRequest({
      ...request,
      env: { CDP_API_KEY_ID: ` ${keyId}\n`, ["CDP_API_KEY_" + "SECRET"]: `\t${privatePart} ` },
      generateJwtImpl: async (options) => { calls.push(options); return validToken; },
    });
    expect(calls).toEqual([{
      apiKeyId: keyId,
      ["apiKey" + "Secret"]: privatePart,
      requestMethod: "pOsT",
      requestHost: "API.Example.com:8443",
      requestPath: "/Case/%2f?query=Verbatim",
      expiresIn: 120,
    }]);
    expect(signed.token).toBe(validToken);
    expect(signed.authorization).toBe("Bearer fixture.signed.value");
  });

  test("passes an explicit signing lifetime through", async () => {
    const lifetimes: unknown[] = [];
    await signCdpRequest({ ...request, env: configured, expiresIn: 45, generateJwtImpl: async (options) => {
      lifetimes.push(options.expiresIn);
      return validToken;
    } });
    expect(lifetimes).toEqual([45]);
  });

  test("resolves complete trimmed credentials", () => {
    const credentials = readCdpCredentials({ CDP_API_KEY_ID: ` ${keyId} `, ["CDP_API_KEY_" + "SECRET"]: ` ${privatePart} ` });
    expect(credentials.status).toBe("complete");
    if (credentials.status !== "complete") throw new Error("Expected complete credentials.");
    expect(credentials.apiKeyId).toBe(keyId);
    expect(credentials.apiKeySecret).toBe(privatePart);
  });

  test.each([
    [{}, "unset"],
    [{ CDP_API_KEY_ID: "", ["CDP_API_KEY_" + "SECRET"]: "" }, "unset"],
    [{ CDP_API_KEY_ID: " \t", ["CDP_API_KEY_" + "SECRET"]: "\n " }, "unset"],
    [{ CDP_API_KEY_ID: keyId }, "partial"],
    [{ ["CDP_API_KEY_" + "SECRET"]: privatePart }, "partial"],
    [{ CDP_API_KEY_ID: keyId, ["CDP_API_KEY_" + "SECRET"]: " \t" }, "partial"],
    [{ CDP_API_KEY_ID: "\n", ["CDP_API_KEY_" + "SECRET"]: privatePart }, "partial"],
  ] as const)("rejects incomplete credentials %j (%s) without calling the signer", async (env, status) => {
    expect(readCdpCredentials(env)).toEqual({ status });
    let calls = 0;
    const error = await signingError(env, async () => { calls += 1; return validToken; });
    assertSafe(error, "not-configured");
    expect(calls).toBe(0);
  });

  test("reads default credentials lazily on each call", async () => {
    process.env.CDP_API_KEY_ID = keyId;
    process.env["CDP_API_KEY_" + "SECRET"] = privatePart;
    const ids: unknown[] = [];
    const generateJwtImpl: CdpJwtGenerator = async (options) => { ids.push(options.apiKeyId); return validToken; };
    await signCdpRequest({ ...request, generateJwtImpl });
    process.env.CDP_API_KEY_ID = "replacement-id";
    await signCdpRequest({ ...request, generateJwtImpl });
    expect(ids).toEqual([keyId, "replacement-id"]);
  });

  test.each(["", " ", "\t\n", "signed value", " signed", "signed\n", "signed\tvalue", null, 123])(
    "rejects malformed SDK output %j without exposing token values", async (value) => {
      const generateJwtImpl = (async () => value) as CdpJwtGenerator;
      const error = await signingError(configured, generateJwtImpl);
      assertSafe(error, "malformed-token");
      if (typeof value === "string" && value.trim()) expect(error.message).not.toContain(value);
    },
  );

  test("sanitizes signing exceptions without retaining their credential-bearing cause", async () => {
    const error = await signingError(configured, async () => {
      throw new Error(`${keyId} ${privatePart} ${validToken}`);
    });
    assertSafe(error, "signing-failed");
  });

  test("sanitizes synchronous SDK exceptions", async () => {
    const error = await signingError(configured, () => { throw new Error(privatePart); });
    assertSafe(error, "signing-failed");
  });
});
