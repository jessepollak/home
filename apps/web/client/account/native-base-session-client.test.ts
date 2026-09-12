import { describe, expect, test } from "bun:test";
import { ACCOUNT_PROVIDER_HEADER } from "@/shared/account/session-types";
import {
  restoreNativeBaseSession,
  type NativeBaseFetch,
} from "./native-base-session-client";

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;

function response(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function session() {
  return {
    user: { subject: "base-subject" },
    smartAccount: { address: ADDRESS, chainId: 8453 as const },
    accountProvider: "base-account" as const,
  };
}

describe("native Base session restoration", () => {
  test("restores only the native provider through a private same-origin request", async () => {
    let input: RequestInfo | URL | undefined;
    let init: RequestInit | undefined;
    const fetchFixture: NativeBaseFetch = async (nextInput, nextInit) => {
      input = nextInput;
      init = nextInit;
      return response(session());
    };

    expect(await restoreNativeBaseSession(fetchFixture)).toEqual(session());
    expect(input).toBe("/api/session");
    expect(init?.method).toBe("GET");
    expect(init?.credentials).toBe("same-origin");
    expect(init?.cache).toBe("no-store");
    expect(new Headers(init?.headers).get(ACCOUNT_PROVIDER_HEADER)).toBe("base-account");
  });

  test("distinguishes a confirmed signed-out response from unavailable restoration", async () => {
    expect(await restoreNativeBaseSession(async () => response({}, 401))).toBeNull();

    for (const fetchFixture of [
      async () => response({ error: { code: "AUTH_UNAVAILABLE" } }, 503),
      async () => response({ malformed: true }),
      async () => { throw new Error("fixture transport failure"); },
    ]) {
      await expect(
        restoreNativeBaseSession(fetchFixture),
      ).rejects.toThrow("Native Base authentication failed.");
    }
  });
});
