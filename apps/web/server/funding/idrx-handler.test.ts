import { describe, expect, test } from "bun:test";
import { IDRX_BASE_ADDRESS, IdrxMintError } from "./idrx";
import {
  createIdrxMintHandler,
  createIdrxRecoveryHandler,
} from "./idrx-handler";
import { MemoryIdrxAttemptStore } from "./idrx-attempt-store";

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;

function authorizedSession() {
  return Response.json({
    user: { subject: "subject-a" },
    smartAccount: { address: ADDRESS, chainId: 8453 },
    accountProvider: "base-account",
  });
}

function recoveryRequest() {
  return new Request("http://localhost:3111/api/funding/idrx-attempt", {
    headers: {
      Authorization: "Bearer fixture-token",
      "X-Home-Account-Provider": "base-account",
    },
  });
}

function request(body: unknown = {
  assetId: "idrx",
  country: "ID",
  toBeMinted: "20000",
  rail: "bank-va",
  channelId: "MANDIRI",
  consent: true,
  attemptId: "11111111-1111-4111-8111-111111111111",
}) {
  return new Request("http://localhost:3111/api/funding/idrx-mint", {
    method: "POST",
    headers: {
      Authorization: "Bearer fixture-token",
      "Content-Type": "application/json",
      "X-Home-Account-Provider": "base-account",
    },
    body: JSON.stringify(body),
  });
}

function vaResult(expiredDate = "2026-09-12T14:00:00.000Z") {
  return {
    presentation: "virtual-account" as const,
    rail: "bank-va" as const,
    asset: { id: "idrx" as const, symbol: "IDRX" as const, decimals: 2 as const, tokenAddress: IDRX_BASE_ADDRESS },
    network: { name: "Base" as const, chainId: 8453 as const },
    merchantOrderId: "order-recovery",
    reference: "ref-recovery",
    virtualAccountNo: "8680770000001234",
    virtualAccountName: "JOHN SMITH",
    amount: "24000",
    baseAmount: "20000",
    fees: [{ name: "VA", amount: "4000" }],
    expiredDate,
    channelId: "MANDIRI" as const,
    verification: { status: "pending" as const, boundary: "balance-and-activity" as const },
  };
}

const recoveryIntent = {
  toBeMinted: "20000",
  rail: "bank-va" as const,
  channelId: "MANDIRI" as const,
  customerSubject: "subject-a",
  customerName: "JOHN SMITH",
};

describe("IDRX mint handler", () => {
  test("binds the session smart account and a same-origin return URL", async () => {
    const calls: Array<{
      address: string;
      toBeMinted: string;
      rail: string;
      channelId?: string;
      returnUrl: string;
    }> = [];
    const handler = createIdrxMintHandler({
      authorize: async () => authorizedSession(),
      resolveCustomer: (subject) => ({ subject, customerName: "JOHN SMITH" }),
      attempts: new MemoryIdrxAttemptStore(),
      createMint: async (options) => {
        calls.push({
          address: options.address,
          toBeMinted: options.toBeMinted,
          rail: options.rail,
          channelId: options.channelId,
          returnUrl: options.returnUrl,
        });
        return {
          presentation: "virtual-account",
          rail: "bank-va",
          asset: {
            id: "idrx",
            symbol: "IDRX",
            decimals: 2,
            tokenAddress: IDRX_BASE_ADDRESS,
          },
          network: { name: "Base", chainId: 8453 },
          merchantOrderId: "20260728130000",
          reference: "SNAP-20260728130000",
          virtualAccountNo: "8680770000001234",
          virtualAccountName: "JOHN SMITH",
          amount: "24000",
          baseAmount: "20000",
          fees: [{ name: "VA Mandiri", amount: "4000" }],
          expiredDate: "2026-07-28T14:00:00.000Z",
          channelId: "MANDIRI",
          verification: { status: "pending", boundary: "balance-and-activity" },
        };
      },
    });

    const response = await handler(request({
      assetId: "idrx",
      country: "ID",
      toBeMinted: "20000",
      rail: "bank-va",
      channelId: "MANDIRI",
      consent: true,
      attemptId: "11111111-1111-4111-8111-111111111111",
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(calls).toEqual([
      {
        address: ADDRESS,
        toBeMinted: "20000",
        rail: "bank-va",
        channelId: "MANDIRI",
        returnUrl: "http://localhost:3111/fund?return=idrx",
      },
    ]);
    expect(await response.json()).toMatchObject({
      presentation: "virtual-account",
      virtualAccountNo: "8680770000001234",
      asset: { decimals: 2, tokenAddress: IDRX_BASE_ADDRESS },
    });
  });

  test("rejects client-authored destination, extra keys, and non-Indonesia rails", async () => {
    let providerCalls = 0;
    const handler = createIdrxMintHandler({
      authorize: async () => authorizedSession(),
      resolveCustomer: (subject) => ({ subject, customerName: "JOHN SMITH" }),
      attempts: new MemoryIdrxAttemptStore(),
      createMint: async () => {
        providerCalls += 1;
        throw new Error("must not run");
      },
    });

    const injected = await handler(
      request({
        assetId: "idrx",
        country: "ID",
        toBeMinted: "20000",
        destinationWalletAddress: "0x2222222222222222222222222222222222222222",
      }),
    );
    expect(injected.status).toBe(400);
    expect((await injected.json()).error.code).toBe("INVALID_IDRX_MINT");

    const otherCountry = await handler(
      request({ assetId: "idrx", country: "US", toBeMinted: "20000" }),
    );
    expect(otherCountry.status).toBe(400);
    expect((await otherCountry.json()).error.code).toBe("IDRX_COUNTRY_UNSUPPORTED");

    const usdc = await handler(request({ assetId: "usdc", country: "ID", toBeMinted: "20000" }));
    expect(usdc.status).toBe(400);
    expect(providerCalls).toBe(0);
  });

  test("gates provider dispatch on the verified customer's credential binding", async () => {
    let providerCalls = 0;
    let attemptCalls = 0;
    const handler = createIdrxMintHandler({
      authorize: async () => authorizedSession(),
      resolveCustomer: () => null,
      attempts: {
        begin: async () => { attemptCalls += 1; return { status: "new" }; },
        recover: async () => ({ status: "none" }),
        complete: async () => {},
        release: async () => {},
      },
      createMint: async () => {
        providerCalls += 1;
        throw new Error("must not run");
      },
    });

    const response = await handler(request());
    expect(response.status).toBe(424);
    expect((await response.json()).error.code).toBe("IDRX_CUSTOMER_NOT_LINKED");
    expect(attemptCalls).toBe(0);
    expect(providerCalls).toBe(0);
  });

  test("recovers a completed owner-bound attempt without a second provider dispatch", async () => {
    const attempts = new MemoryIdrxAttemptStore();
    let providerCalls = 0;
    const handler = createIdrxMintHandler({
      authorize: async () => authorizedSession(),
      resolveCustomer: (subject) => ({ subject, customerName: "JOHN SMITH" }),
      attempts,
      createMint: async () => {
        providerCalls += 1;
        return {
          presentation: "hosted",
          rail: "qris",
          asset: { id: "idrx", symbol: "IDRX", decimals: 2, tokenAddress: IDRX_BASE_ADDRESS },
          network: { name: "Base", chainId: 8453 },
          merchantOrderId: "order-once",
          url: "https://checkout.idrx.co/?token=fixture",
          verification: { status: "pending", boundary: "balance-and-activity" },
        };
      },
    });

    const first = await handler(request({
      assetId: "idrx", country: "ID", toBeMinted: "20000", rail: "qris",
      consent: true, attemptId: "22222222-2222-4222-8222-222222222222",
    }));
    const recovered = await handler(request({
      assetId: "idrx", country: "ID", toBeMinted: "20000", rail: "qris",
      consent: true, attemptId: "22222222-2222-4222-8222-222222222222",
    }));
    const recoveredAfterTabLoss = await handler(request({
      assetId: "idrx", country: "ID", toBeMinted: "20000", rail: "qris",
      consent: true, attemptId: "44444444-4444-4444-8444-444444444444",
    }));
    expect(first.status).toBe(200);
    expect(recovered.status).toBe(200);
    expect(recoveredAfterTabLoss.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ merchantOrderId: "order-once" });
    expect(await recoveredAfterTabLoss.json()).toMatchObject({ merchantOrderId: "order-once" });
    expect(providerCalls).toBe(1);
  });

  test("rejects attempt-ID reuse with changed immutable intent", async () => {
    const attempts = new MemoryIdrxAttemptStore();
    let providerCalls = 0;
    const handler = createIdrxMintHandler({
      authorize: async () => authorizedSession(),
      resolveCustomer: (subject) => ({ subject, customerName: "JOHN SMITH" }),
      attempts,
      createMint: async () => {
        providerCalls += 1;
        throw new IdrxMintError("unavailable");
      },
    });
    const attemptId = "55555555-5555-4555-8555-555555555555";
    expect((await handler(request({
      assetId: "idrx", country: "ID", toBeMinted: "20000", rail: "qris",
      consent: true, attemptId,
    }))).status).toBe(409);
    const mismatch = await handler(request({
      assetId: "idrx", country: "ID", toBeMinted: "30000", rail: "qris",
      consent: true, attemptId,
    }));
    expect(mismatch.status).toBe(409);
    expect((await mismatch.json()).error.code).toBe("IDRX_ATTEMPT_MISMATCH");
    expect(providerCalls).toBe(1);
  });

  test("retains an ambiguous failed attempt and refuses a second provider dispatch", async () => {
    const attempts = new MemoryIdrxAttemptStore();
    let providerCalls = 0;
    const handler = createIdrxMintHandler({
      authorize: async () => authorizedSession(),
      resolveCustomer: (subject) => ({ subject, customerName: "JOHN SMITH" }),
      attempts,
      createMint: async () => {
        providerCalls += 1;
        throw new IdrxMintError("unavailable");
      },
    });
    const body = {
      assetId: "idrx", country: "ID", toBeMinted: "20000", rail: "qris",
      consent: true, attemptId: "33333333-3333-4333-8333-333333333333",
    };
    expect((await handler(request(body))).status).toBe(409);
    const retry = await handler(request(body));
    expect(retry.status).toBe(409);
    expect((await retry.json()).error.code).toBe("IDRX_ATTEMPT_PENDING");
    expect(providerCalls).toBe(1);
  });

  test("preserves unauthenticated privacy and never calls IDRX", async () => {
    let providerCalls = 0;
    const handler = createIdrxMintHandler({
      authorize: async () =>
        Response.json(
          { error: { code: "UNAUTHENTICATED", message: "A valid access token is required." } },
          { status: 401 },
        ),
      resolveCustomer: (subject) => ({ subject, customerName: "JOHN SMITH" }),
      attempts: new MemoryIdrxAttemptStore(),
      createMint: async () => {
        providerCalls += 1;
        throw new Error("must not run");
      },
    });

    const response = await handler(request());
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(providerCalls).toBe(0);
  });
});

describe("IDRX attempt recovery", () => {
  test("returns completed VA instructions after the initiating response was lost", async () => {
    const attempts = new MemoryIdrxAttemptStore();
    const attemptId = "66666666-6666-4666-8666-666666666666";
    await attempts.begin({ subject: "subject-a", smartAccount: ADDRESS }, attemptId, recoveryIntent);
    await attempts.complete({ subject: "subject-a", smartAccount: ADDRESS }, attemptId, vaResult());
    let statusReads = 0;
    const handler = createIdrxRecoveryHandler({
      authorize: async () => authorizedSession(),
      resolveCustomer: (subject) => ({ subject, customerName: "JOHN SMITH" }),
      attempts,
      readStatus: async () => { statusReads += 1; return "pending"; },
      now: () => Date.parse("2026-09-11T12:00:00.000Z"),
    });
    const response = await handler(recoveryRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "completed",
      result: { virtualAccountNo: "8680770000001234" },
    });
    expect(statusReads).toBe(1);
  });

  test("releases an authoritatively expired reservation but preserves its attempt replay record", async () => {
    const attempts = new MemoryIdrxAttemptStore();
    const attemptId = "77777777-7777-4777-8777-777777777777";
    const owner = { subject: "subject-a", smartAccount: ADDRESS };
    await attempts.begin(owner, attemptId, recoveryIntent);
    await attempts.complete(owner, attemptId, vaResult("2026-09-11T11:00:00.000Z"));
    const handler = createIdrxRecoveryHandler({
      authorize: async () => authorizedSession(),
      resolveCustomer: (subject) => ({ subject, customerName: "JOHN SMITH" }),
      attempts,
      readStatus: async () => { throw new Error("must not read after expiry"); },
      now: () => Date.parse("2026-09-11T12:00:00.000Z"),
    });
    const response = await handler(recoveryRequest());
    expect(await response.json()).toEqual({ status: "terminal", outcome: "expired" });
    expect(await attempts.recover(owner)).toEqual({ status: "none" });
    expect(await attempts.begin(owner, attemptId, recoveryIntent)).toEqual({
      status: "terminal",
      outcome: "expired",
    });
    expect(await attempts.begin(owner, "88888888-8888-4888-8888-888888888888", {
      ...recoveryIntent,
      toBeMinted: "30000",
    })).toEqual({ status: "new" });
  });

  test("uses bounded read-only provider status to release a terminal hosted attempt", async () => {
    const attempts = new MemoryIdrxAttemptStore();
    const attemptId = "99999999-9999-4999-8999-999999999999";
    const owner = { subject: "subject-a", smartAccount: ADDRESS };
    const hostedIntent = { ...recoveryIntent, rail: "qris" as const, channelId: null };
    await attempts.begin(owner, attemptId, hostedIntent);
    await attempts.complete(owner, attemptId, {
      presentation: "hosted",
      rail: "qris",
      asset: { id: "idrx", symbol: "IDRX", decimals: 2, tokenAddress: IDRX_BASE_ADDRESS },
      network: { name: "Base", chainId: 8453 },
      merchantOrderId: "order-hosted",
      url: "https://checkout.idrx.co/?token=fixture",
      verification: { status: "pending", boundary: "balance-and-activity" },
    });
    const handler = createIdrxRecoveryHandler({
      authorize: async () => authorizedSession(),
      resolveCustomer: (subject) => ({ subject, customerName: "JOHN SMITH" }),
      attempts,
      readStatus: async ({ merchantOrderId }) => {
        expect(merchantOrderId).toBe("order-hosted");
        return "minted";
      },
    });
    expect(await (await handler(recoveryRequest())).json()).toEqual({
      status: "terminal",
      outcome: "minted",
    });
    expect(await attempts.recover(owner)).toEqual({ status: "none" });
  });
});
