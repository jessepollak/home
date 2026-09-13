import { describe, expect, test } from "bun:test";
import { encodeAbiParameters } from "viem";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { createTradeSignerResolver } from "./signer";

const SMART = "0x1111111111111111111111111111111111111111" as const;
const OWNER = "0x2222222222222222222222222222222222222222" as const;
const session: VerifiedAccountSession = {
  user: { subject: "trade-user" },
  smartAccount: { address: SMART, chainId: 8453 },
  accountProvider: "cdp-embedded",
};

function request() {
  return new Request("https://home.test/api/trades", {
    headers: { authorization: "Bearer aaa.bbb.ccc" },
  });
}

function validator(owner = OWNER) {
  return {
    validateAccessToken: async () => ({
      userId: "trade-user",
      evmAccountObjects: [{ address: owner }],
      evmSmartAccountObjects: [{ address: SMART, ownerAddresses: [owner] }],
    }),
  };
}

function rpcFetch(results: unknown[]): typeof fetch {
  return (async () => Response.json({ jsonrpc: "2.0", id: 1, result: results.shift() })) as unknown as typeof fetch;
}

describe("trade signer resolver", () => {
  test("requires the freshly controlled owner encoded at current smart-wallet index zero", async () => {
    const ownerBytes = encodeAbiParameters([{ type: "address" }], [OWNER]);
    const resolver = createTradeSignerResolver({
      getValidator: async () => validator(),
      fetchImpl: rpcFetch([
        "0x2105",
        "0x01",
        encodeAbiParameters([{ type: "bytes" }], [ownerBytes]),
        encodeAbiParameters([{ type: "bool" }], [true]),
      ]),
      rpcUrl: "https://rpc.test",
    });
    await expect(resolver(request(), session)).resolves.toEqual({
      smartAccount: SMART,
      signerAddress: OWNER,
      ownerIndex: 0,
      deployed: true,
    });
  });

  test("fails closed on a non-Base RPC chain", async () => {
    const resolver = createTradeSignerResolver({
      getValidator: async () => validator(),
      fetchImpl: rpcFetch(["0x1"]),
      rpcUrl: "https://rpc.test",
    });
    await expect(resolver(request(), session)).rejects.toMatchObject({ reason: "provider-unavailable" });
  });

  test("resolves a deployed Base Account from on-chain index-zero ownership", async () => {
    const ownerBytes = encodeAbiParameters([{ type: "address" }], [OWNER]);
    const resolver = createTradeSignerResolver({
      getValidator: async () => validator(),
      fetchImpl: rpcFetch([
        "0x2105",
        "0x01",
        encodeAbiParameters([{ type: "bytes" }], [ownerBytes]),
        encodeAbiParameters([{ type: "bool" }], [true]),
      ]),
      rpcUrl: "https://rpc.test",
    });
    await expect(resolver(request(), { ...session, accountProvider: "base-account" })).resolves.toEqual({
      smartAccount: SMART,
      signerAddress: OWNER,
      ownerIndex: 0,
      deployed: true,
    });
  });

  test("uses the Base Account smart wallet as the quote signer when owner zero is not an address", async () => {
    const passkeyOwner = encodeAbiParameters([{ type: "bytes" }], [`0x${"ab".repeat(64)}`]);
    const resolver = createTradeSignerResolver({
      getValidator: async () => validator(),
      fetchImpl: rpcFetch([
        "0x2105",
        "0x01",
        passkeyOwner,
      ]),
      rpcUrl: "https://rpc.test",
    });
    await expect(resolver(request(), { ...session, accountProvider: "base-account" })).resolves.toEqual({
      smartAccount: SMART,
      signerAddress: SMART,
      ownerIndex: 0,
      deployed: true,
    });
  });

  test("rejects an undeployed Base Account before quoting", async () => {
    const resolver = createTradeSignerResolver({
      getValidator: async () => validator(),
      fetchImpl: rpcFetch(["0x2105", "0x"]),
      rpcUrl: "https://rpc.test",
    });
    await expect(resolver(request(), { ...session, accountProvider: "base-account" })).rejects.toMatchObject({
      reason: "signer-unsupported",
    });
  });

  test("never substitutes an uncontrolled EOA for the verified smart-account owner", async () => {
    const resolver = createTradeSignerResolver({
      getValidator: async () => ({
        validateAccessToken: async () => ({
          userId: "trade-user",
          evmAccountObjects: [{ address: OWNER }],
          evmSmartAccountObjects: [{
            address: SMART,
            ownerAddresses: ["0x3333333333333333333333333333333333333333"],
          }],
        }),
      }),
      fetchImpl: rpcFetch([]),
      rpcUrl: "https://rpc.test",
    });
    await expect(resolver(request(), session)).rejects.toMatchObject({ reason: "signer-unsupported" });
  });
});
