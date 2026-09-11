import { describe, expect, test } from "bun:test";
import { createPortfolioHandler } from "./handler";
import {
  BASE_CHAIN_ID,
  BASE_USDC_ADDRESS,
  type PortfolioSnapshot,
} from "@/shared/portfolio/types";

const VERIFIED_ADDRESS = "0x1111111111111111111111111111111111111111";
const ATTACKER_ADDRESS = "0x9999999999999999999999999999999999999999";

const snapshot: PortfolioSnapshot = {
  walletAddress: VERIFIED_ADDRESS,
  chainId: BASE_CHAIN_ID,
  blockNumber: "16",
  blockHash: `0x${"ab".repeat(32)}`,
  blockTimestamp: "100",
  fetchedAt: "2026-09-07T20:30:00.000Z",
  assets: [
    {
      id: "usdc",
      symbol: "USDC",
      decimals: 6,
      kind: "erc20",
      tokenAddress: BASE_USDC_ADDRESS,
      balanceBaseUnits: "7",
    },
    {
      id: "eth",
      symbol: "ETH",
      decimals: 18,
      kind: "native",
      balanceBaseUnits: "42",
    },
  ],
};

function verifiedSession(address: string = VERIFIED_ADDRESS) {
  return Response.json(
    {
      user: { subject: "cdp-user-123" },
      smartAccount: { address, chainId: BASE_CHAIN_ID },
      accountProvider: "cdp-embedded",
    },
    {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        Pragma: "no-cache",
        Vary: "Authorization",
      },
    },
  );
}

function expectPrivate(response: Response) {
  expect(response.headers.get("cache-control")).toBe(
    "private, no-store, max-age=0",
  );
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("vary")).toBe(
    "Authorization, X-Home-Account-Provider",
  );
}

describe("portfolio route handler", () => {
  test("passes the original request through the in-process session boundary", async () => {
    let boundaryRequest: Request | undefined;
    const request = new Request(
      `http://localhost:3115/api/portfolio?wallet=${ATTACKER_ADDRESS}&mode=base-account`,
      { headers: { "x-request-marker": "preserve-me" } },
    );
    const handler = createPortfolioHandler({
      authorize: async (received) => {
        boundaryRequest = received;
        return verifiedSession();
      },
      readPortfolio: async () => snapshot,
    });

    const response = await handler(request);

    expect(boundaryRequest).toBe(request);
    expect(boundaryRequest?.url).toBe(request.url);
    expect(boundaryRequest?.headers.get("x-request-marker")).toBe("preserve-me");
    expect(response.status).toBe(200);
    expectPrivate(response);
  });

  test("rejects a successful session response whose provider disagrees with the request selector", async () => {
    let readCalls = 0;
    const handler = createPortfolioHandler({
      authorize: async () =>
        Response.json({
          user: { subject: "siwe-user" },
          smartAccount: {
            address: VERIFIED_ADDRESS,
            chainId: BASE_CHAIN_ID,
          },
          accountProvider: "cdp-embedded",
        }),
      readPortfolio: async () => {
        readCalls += 1;
        return snapshot;
      },
    });

    const response = await handler(
      new Request("http://localhost:3115/api/portfolio", {
        headers: { "X-Home-Account-Provider": "base-account" },
      }),
    );

    expect(response.status).toBe(503);
    expectPrivate(response);
    expect(readCalls).toBe(0);
  });

  test("uses only the verified smart account and ignores browser wallet scope", async () => {
    let receivedAddress: string | undefined;
    const handler = createPortfolioHandler({
      authorize: async () => verifiedSession(),
      readPortfolio: async (account) => {
        receivedAddress = account.address;
        expect(account.verification).toBe("session-smart-account");
        expect(account.chainId).toBe(8453);
        return snapshot;
      },
    });

    const response = await handler(
      new Request(
        `http://localhost:3115/api/portfolio?wallet=${ATTACKER_ADDRESS}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(receivedAddress).toBe(VERIFIED_ADDRESS);
    expect(receivedAddress).not.toBe(ATTACKER_ADDRESS);
  });

  test("relays 401 and 503 session failures without touching the RPC reader", async () => {
    for (const status of [401, 503]) {
      const boundaryFailure = Response.json(
        { error: { code: "BOUNDARY_FAILURE" } },
        {
          status,
          headers: {
            "Cache-Control": "private, no-store, max-age=0",
            Pragma: "no-cache",
            Vary: "Authorization, X-Home-Account-Provider",
          },
        },
      );
      let readCalls = 0;
      const handler = createPortfolioHandler({
        authorize: async () => boundaryFailure,
        readPortfolio: async () => {
          readCalls += 1;
          return snapshot;
        },
      });

      const response = await handler(
        new Request("http://localhost:3115/api/portfolio"),
      );
      expect(response).toBe(boundaryFailure);
      expect(response.status).toBe(status);
      expectPrivate(response);
      expect(readCalls).toBe(0);
    }
  });

  test("keeps a missing smart account unavailable and never falls back to an EOA", async () => {
    let readCalls = 0;
    const handler = createPortfolioHandler({
      authorize: async () =>
        Response.json({
          user: { subject: "cdp-user-123" },
          smartAccount: null,
          accountProvider: "cdp-embedded",
        }),
      readPortfolio: async () => {
        readCalls += 1;
        return snapshot;
      },
    });

    const response = await handler(
      new Request("http://localhost:3115/api/portfolio"),
    );

    expect(response.status).toBe(503);
    expectPrivate(response);
    expect(await response.json()).toEqual({
      error: {
        code: "SMART_ACCOUNT_UNAVAILABLE",
        message: "A verified Base smart account is not available yet.",
      },
    });
    expect(readCalls).toBe(0);
  });

  test("returns an unavailable error rather than zero balances on RPC failure", async () => {
    const handler = createPortfolioHandler({
      authorize: async () => verifiedSession(),
      readPortfolio: async () => {
        throw new Error("private provider detail");
      },
    });

    const response = await handler(
      new Request("http://localhost:3115/api/portfolio"),
    );

    expect(response.status).toBe(502);
    expectPrivate(response);
    expect(await response.json()).toEqual({
      error: {
        code: "PORTFOLIO_UNAVAILABLE",
        message: "Current Base balances are temporarily unavailable.",
      },
    });
  });

  test("fails closed if the successful boundary response is malformed", async () => {
    const handler = createPortfolioHandler({
      authorize: async () =>
        Response.json({
          user: { subject: "cdp-user-123" },
          smartAccount: { address: VERIFIED_ADDRESS, chainId: 1 },
          accountProvider: "cdp-embedded",
        }),
      readPortfolio: async () => snapshot,
    });

    const response = await handler(
      new Request("http://localhost:3115/api/portfolio"),
    );
    expect(response.status).toBe(503);
    expectPrivate(response);
  });
});
