import { describe, expect, test } from "bun:test";
import type { Address, MorphoVaultPosition } from "@/shared/savings/types";
import { createSavingsPositionsHandler } from "./position-handler";

const ADDRESS = "0x1111111111111111111111111111111111111111" as Address;
const OTHER = "0x9999999999999999999999999999999999999999" as Address;
const VAULT = "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61" as Address;

const position: MorphoVaultPosition = {
  version: "v1",
  accountAddress: ADDRESS,
  vaultAddress: VAULT,
  assetsRaw: "1234567",
  sharesRaw: "1200000",
  indexedAt: "2026-09-07T20:30:00.000Z",
  source: {
    provider: "Morpho GraphQL",
    endpoint: "https://api.morpho.org/graphql",
    query: "vaultPosition",
    fetchedAt: "2026-09-07T20:30:01.000Z",
  },
  withdrawableRaw: null,
  withdrawableNote: "No maxWithdraw query was made.",
};

function authorized() {
  return Response.json({
    user: { subject: "verified-subject" },
    smartAccount: { address: ADDRESS, chainId: 8453 },
    accountProvider: "base-account",
  });
}

function request() {
  return new Request(`http://localhost/api/savings/positions?wallet=${OTHER}`, {
    headers: { "X-Home-Account-Provider": "base-account" },
  });
}

describe("authenticated savings positions handler", () => {
  test("scopes configured position reads to the verified wallet and private headers", async () => {
    let received = "";
    const handler = createSavingsPositionsHandler({
      authorize: async () => authorized(),
      readPositions: async (account) => {
        received = account.address;
        return {
          accountAddress: account.address,
          fetchedAt: "2026-09-07T20:30:02.000Z",
          vaults: [{ vaultAddress: VAULT, position }],
        };
      },
    });

    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(received).toBe(ADDRESS);
    expect(received).not.toBe(OTHER);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("vary")).toBe("Authorization, X-Home-Account-Provider");
  });

  test("preserves no indexed position as null rather than asserting zero", async () => {
    const handler = createSavingsPositionsHandler({
      authorize: async () => authorized(),
      readPositions: async (account) => ({
        accountAddress: account.address,
        fetchedAt: "2026-09-07T20:30:02.000Z",
        vaults: [{ vaultAddress: VAULT, position: null }],
      }),
    });

    const response = await handler(request());
    const body = await response.json();
    expect(body.vaults[0].position).toBeNull();
  });

  test("does not call Morpho after a provider-mismatched auth response", async () => {
    let reads = 0;
    const handler = createSavingsPositionsHandler({
      authorize: async () => authorized(),
      readPositions: async () => {
        reads += 1;
        return { accountAddress: ADDRESS, fetchedAt: "", vaults: [] };
      },
    });

    const response = await handler(
      new Request("http://localhost/api/savings/positions", {
        headers: { "X-Home-Account-Provider": "cdp-embedded" },
      }),
    );
    expect(response.status).toBe(503);
    expect(reads).toBe(0);
  });
});
