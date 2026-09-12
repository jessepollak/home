import { describe, expect, test } from "bun:test";
import { ACCOUNT_PROVIDER_HEADER } from "@/shared/account/session-types";
import {
  HOME_CHALLENGE_COOKIE,
  HOME_SESSION_COOKIE,
  MemoryNativeBaseNonceStore,
  createNativeBaseNonceHandler,
  createNativeBaseVerifyHandler,
} from "@/server/auth/native-base-session";
import { createSessionHandler } from "@/server/cdp/session";
import { createTransferReceiptHandler } from "./handler";

const SECRET = "test-only-transfer-session-secret-32-bytes-minimum";
const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const HASH = `0x${"ab".repeat(32)}` as const;
const ORIGIN = "https://home.example";

function cookiePair(response: Response, name: string): string {
  const value = response.headers.getSetCookie().find((header) =>
    header.startsWith(`${name}=`),
  );
  if (!value) throw new Error(`Missing ${name}`);
  return value.slice(0, value.indexOf(";"));
}

async function nativeSessionCookie(): Promise<string> {
  const store = new MemoryNativeBaseNonceStore();
  const dependencies = {
    sessionSecret: SECRET,
    store,
    randomId: () => "a".repeat(48),
    verify: async () => true,
  };
  const nonce = await createNativeBaseNonceHandler(dependencies)(
    new Request(`${ORIGIN}/api/auth/base/nonce`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: ADDRESS }),
    }),
  );
  const { message } = await nonce.json() as { message: string };
  const verified = await createNativeBaseVerifyHandler(dependencies)(
    new Request(`${ORIGIN}/api/auth/base/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookiePair(nonce, HOME_CHALLENGE_COOKIE),
      },
      body: JSON.stringify({ message, signature: "0x1234" }),
    }),
  );
  expect(verified.status).toBe(200);
  return cookiePair(verified, HOME_SESSION_COOKIE);
}

describe("authenticated transfer receipt handler", () => {
  test("accepts only the matching native signed-cookie session without bearer fallback", async () => {
    const cookie = await nativeSessionCookie();
    let validatorReads = 0;
    let receiptReads = 0;
    const authorize = createSessionHandler({
      getValidator: async () => {
        validatorReads += 1;
        return { validateAccessToken: async () => { throw new Error("unexpected"); } };
      },
      baseAccountEnabled: true,
      homeSessionSecret: SECRET,
      nativeBaseAccountEnabled: true,
    });
    const handler = createTransferReceiptHandler({
      authorize,
      readReceipt: async (transactionHash) => {
        receiptReads += 1;
        return {
          status: "confirmed",
          transactionHash,
          blockNumber: "17",
          success: true,
        };
      },
    });

    const response = await handler(new Request(
      `${ORIGIN}/api/transfer-receipt?hash=${HASH}`,
      {
        headers: {
          Cookie: cookie,
          [ACCOUNT_PROVIDER_HEADER]: "base-account",
        },
      },
    ));
    expect(response.status).toBe(200);
    expect(response.headers.get("vary")).toBe(
      `Cookie, Authorization, ${ACCOUNT_PROVIDER_HEADER}`,
    );
    expect(await response.json()).toEqual({
      status: "confirmed",
      transactionHash: HASH,
      blockNumber: "17",
      success: true,
    });
    expect({ validatorReads, receiptReads }).toEqual({ validatorReads: 0, receiptReads: 1 });

    const mixedProvider = await handler(new Request(
      `${ORIGIN}/api/transfer-receipt?hash=${HASH}`,
      {
        headers: {
          Cookie: cookie,
          [ACCOUNT_PROVIDER_HEADER]: "cdp-embedded",
        },
      },
    ));
    expect(mixedProvider.status).toBe(400);
    expect(receiptReads).toBe(1);
  });
});
