import { describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { MoneyActionCall } from "@/shared/money-actions/types";
import { BASE_USDC_ADDRESS, MORPHO_V1_CANDIDATE_ADDRESSES } from "@/shared/savings/config";
import type { Address } from "@/shared/savings/types";
import { CoinbaseSmartAccountBatchSimulationError } from "@/server/chain/coinbase-smart-account";
import { SavingsActionError, createPrepareSavingsAction } from "./prepare";
import { SavingsActionRpcError } from "./rpc";
import type {
  SavingsActionBatchSimulator,
  SavingsActionState,
  SavingsActionStateReader,
} from "./types";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const VAULT = MORPHO_V1_CANDIDATE_ADDRESSES[0].toLowerCase() as Address;
const BLOCK_HASH = `0x${"ab".repeat(32)}` as `0x${string}`;

const session: VerifiedAccountSession = {
  user: { subject: "subject-a" },
  smartAccount: { address: ACCOUNT, chainId: 8453 },
  accountProvider: "cdp-embedded",
};

const baseState: SavingsActionState = {
  block: {
    number: "34567890",
    numberHex: "0x20f76d2",
    hash: BLOCK_HASH,
    timestamp: "1788872400",
  },
  assetAddress: BASE_USDC_ADDRESS,
  shareDecimals: 18,
  usdcBalance: BigInt("9000000"),
  sharesBalance: BigInt("4000000000000000000"),
  allowance: BigInt(0),
  limit: BigInt("8000000"),
  previewShares: BigInt("1490000000000000000"),
  fee: BigInt("100000000000000000"),
};

function word(value: bigint | string) {
  const hex = typeof value === "bigint" ? value.toString(16) : value.replace(/^0x/, "");
  return hex.toLowerCase().padStart(64, "0");
}

function addressWord(address: string) {
  return word(address.slice(2));
}

const simulateSuccessfully: SavingsActionBatchSimulator = async () => {};

describe("Morpho savings action preparation", () => {
  test("prepares and simulates exact approval then direct deposit in one ordered action plan", async () => {
    const readInputs: Array<Parameters<SavingsActionStateReader>[0]> = [];
    const simulations: Array<{
      calls: readonly MoneyActionCall[];
      account: Address;
      source: { blockNumber: string; blockHash: `0x${string}` };
    }> = [];
    const prepare = createPrepareSavingsAction({
      now: () => new Date("2026-09-08T10:00:00.000Z"),
      readState: async (input) => {
        readInputs.push(input);
        return baseState;
      },
      simulateBatch: async (calls, account, source) => {
        simulations.push({ calls, account, source });
      },
    });

    const action = await prepare({
      session,
      action: {
        kind: "deposit",
        vaultAddress: VAULT,
        amountBaseUnits: "1500000",
      },
    });

    expect(readInputs[0]).toEqual({
      kind: "deposit",
      accountAddress: ACCOUNT,
      vaultAddress: VAULT,
      amount: BigInt("1500000"),
    });
    expect(action.kind).toBe("savings-deposit");
    expect(action.expiresAt).toBe("2026-09-08T10:05:00.000Z");
    expect(action.calls).toEqual([
      {
        to: BASE_USDC_ADDRESS,
        data: `0x095ea7b3${addressWord(VAULT)}${word(BigInt("1500000"))}`,
        value: "0",
        approval: {
          assetId: "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          spender: VAULT,
        },
      },
      {
        to: VAULT,
        data: `0x6e553f65${word(BigInt("1500000"))}${addressWord(ACCOUNT)}`,
        value: "0",
      },
    ]);
    expect(simulations).toEqual([{
      calls: action.calls,
      account: ACCOUNT,
      source: { blockNumber: baseState.block.number, blockHash: BLOCK_HASH },
    }]);
    expect(action.amounts).toEqual([
      expect.objectContaining({
        symbol: "USDC",
        amountBaseUnits: "1500000",
        decimals: 6,
        direction: "spend",
      }),
      expect.objectContaining({
        symbol: "vault shares",
        amountBaseUnits: "1490000000000000000",
        decimals: 18,
        direction: "receive",
        estimated: true,
      }),
    ]);
    expect(action.warnings.join(" ")).toContain("not a guaranteed minimum");
    expect(action.warnings.join(" ")).toContain("Current vault fee: 10%");
  });

  test("binds withdrawal ownership to the verified account, expires it, and rejects current-limit excess", async () => {
    let state = {
      ...baseState,
      allowance: null,
      limit: BigInt("2000000"),
      previewShares: BigInt("1900000000000000000"),
    };
    const simulatedCalls: Array<readonly MoneyActionCall[]> = [];
    const prepare = createPrepareSavingsAction({
      now: () => new Date("2026-09-08T11:30:00.000Z"),
      readState: async () => state,
      simulateBatch: async (calls) => {
        simulatedCalls.push(calls);
      },
    });

    const action = await prepare({
      session,
      action: {
        kind: "withdraw",
        vaultAddress: VAULT,
        amountBaseUnits: "2000000",
      },
    });

    expect(action.expiresAt).toBe("2026-09-08T11:35:00.000Z");
    expect(action.calls).toEqual([
      {
        to: VAULT,
        data: `0xb460af94${word(BigInt("2000000"))}${addressWord(ACCOUNT)}${addressWord(ACCOUNT)}`,
        value: "0",
      },
    ]);
    expect(simulatedCalls).toEqual([action.calls]);
    expect(action.amounts[0]).toEqual(expect.objectContaining({
      symbol: "vault shares",
      amountBaseUnits: "1900000000000000000",
      estimated: true,
      direction: "spend",
    }));
    expect(action.amounts[1]).toEqual(expect.objectContaining({
      symbol: "USDC",
      amountBaseUnits: "2000000",
      direction: "receive",
    }));
    expect(action.warnings.join(" ")).toContain(`receiver and owner are the verified smart account ${ACCOUNT}`);

    state = { ...state, limit: BigInt("1999999") };
    await expect(prepare({
      session,
      action: {
        kind: "withdraw",
        vaultAddress: VAULT,
        amountBaseUnits: "2000000",
      },
    })).rejects.toMatchObject({
      name: "SavingsActionError",
      reason: "limit-exceeded",
    } satisfies Partial<SavingsActionError>);
  });

  test("prepares a 5 USDC Gauntlet-shaped deposit and retries a transient RPC read once", async () => {
    let attempts = 0;
    const prepare = createPrepareSavingsAction({
      now: () => new Date("2026-09-08T21:13:00.000Z"),
      simulateBatch: simulateSuccessfully,
      readState: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new SavingsActionRpcError("The Base source block changed while savings state was fetched.");
        }
        return {
          ...baseState,
          fee: BigInt(0),
          allowance: BigInt(0),
          usdcBalance: BigInt("9000000"),
          limit: BigInt("100364354472113921"),
          previewShares: BigInt("4502349201208201236"),
        };
      },
    });

    const action = await prepare({
      session,
      action: {
        kind: "deposit",
        vaultAddress: VAULT,
        amountBaseUnits: "5000000",
      },
    });

    expect(attempts).toBe(2);
    expect(action.kind).toBe("savings-deposit");
    expect(action.amounts[0]).toEqual(expect.objectContaining({
      symbol: "USDC",
      amountBaseUnits: "5000000",
      direction: "spend",
    }));
    expect(action.amounts[1]).toEqual(expect.objectContaining({
      amountBaseUnits: "4502349201208201236",
      estimated: true,
      direction: "receive",
    }));
    expect(action.warnings.join(" ")).toContain("Current vault fee: 0%");
  });

  test("maps a rate-limited state read to a typed reason and retries after a pause", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const prepare = createPrepareSavingsAction({
      now: () => new Date("2026-09-09T00:00:00.000Z"),
      simulateBatch: simulateSuccessfully,
      retryDelayMs: 400,
      sleep: async (ms) => {
        delays.push(ms);
      },
      readState: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new SavingsActionRpcError(
            "Base RPC rejected a savings state read: over rate limit",
            { code: "rate-limited" },
          );
        }
        return baseState;
      },
    });

    const action = await prepare({
      session,
      action: {
        kind: "deposit",
        vaultAddress: VAULT,
        amountBaseUnits: "1500000",
      },
    });

    expect(attempts).toBe(2);
    expect(delays).toEqual([400]);
    expect(action.kind).toBe("savings-deposit");
  });

  test("keeps a persistent rate limit typed instead of wrapping it as unavailable", async () => {
    const prepare = createPrepareSavingsAction({
      simulateBatch: simulateSuccessfully,
      retryDelayMs: 0,
      readState: async () => {
        throw new SavingsActionRpcError(
          "Base RPC rejected a savings state read: over rate limit",
          { code: "rate-limited" },
        );
      },
    });

    await expect(prepare({
      session,
      action: {
        kind: "deposit",
        vaultAddress: VAULT,
        amountBaseUnits: "5000000",
      },
    })).rejects.toMatchObject({
      name: "SavingsActionError",
      reason: "rate-limited",
      message: "Base RPC is rate limited. Try again shortly.",
    } satisfies Partial<SavingsActionError>);
  });

  test("preserves the RPC failure instead of wrapping it as a generic unavailable error", async () => {
    const prepare = createPrepareSavingsAction({
      simulateBatch: simulateSuccessfully,
      readState: async () => {
        throw new SavingsActionRpcError("Base RPC rejected a savings state read: execution reverted");
      },
    });

    await expect(prepare({
      session,
      action: {
        kind: "deposit",
        vaultAddress: VAULT,
        amountBaseUnits: "5000000",
      },
    })).rejects.toMatchObject({
      name: "SavingsActionError",
      reason: "rpc",
      message: "Base RPC rejected a savings state read: execution reverted",
    } satisfies Partial<SavingsActionError>);
  });

  test("simulates only the deposit call when the existing allowance is sufficient", async () => {
    const simulations: Array<readonly MoneyActionCall[]> = [];
    const prepare = createPrepareSavingsAction({
      readState: async () => ({
        ...baseState,
        allowance: BigInt("1500000"),
      }),
      simulateBatch: async (calls) => {
        simulations.push(calls);
      },
    });

    const action = await prepare({
      session,
      action: {
        kind: "deposit",
        vaultAddress: VAULT,
        amountBaseUnits: "1500000",
      },
    });

    expect(action.calls).toHaveLength(1);
    expect(action.calls[0]).toEqual({
      to: VAULT,
      data: `0x6e553f65${word(BigInt("1500000"))}${addressWord(ACCOUNT)}`,
      value: "0",
    });
    expect(simulations).toEqual([action.calls]);
  });

  test("retries a rate-limited batch simulation once before succeeding", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const prepare = createPrepareSavingsAction({
      readState: async () => baseState,
      retryDelayMs: 400,
      sleep: async (ms) => {
        delays.push(ms);
      },
      simulateBatch: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new CoinbaseSmartAccountBatchSimulationError(
            "Base RPC rejected a smart-account batch simulation call.",
            "rpc",
            { rpcErrorCode: "rpc", rpcCode: -32016 },
          );
        }
      },
    });

    await expect(prepare({
      session,
      action: { kind: "deposit", vaultAddress: VAULT, amountBaseUnits: "1500000" },
    })).resolves.toMatchObject({ kind: "savings-deposit" });
    expect(attempts).toBe(2);
    expect(delays).toEqual([400]);
  });

  test("keeps persistent simulation rate limits typed for Save", async () => {
    for (const detail of [
      { rpcErrorCode: "http" as const, httpStatus: 429 },
      { rpcErrorCode: "rpc" as const, rpcCode: -32005 },
    ]) {
      let attempts = 0;
      const prepare = createPrepareSavingsAction({
        readState: async () => baseState,
        retryDelayMs: 0,
        simulateBatch: async () => {
          attempts += 1;
          throw new CoinbaseSmartAccountBatchSimulationError(
            "Base RPC rejected a smart-account batch simulation call.",
            "rpc",
            detail,
          );
        },
      });

      await expect(prepare({
        session,
        action: { kind: "withdraw", vaultAddress: VAULT, amountBaseUnits: "1500000" },
      })).rejects.toMatchObject({
        name: "SavingsActionError",
        reason: "rate-limited",
        message: "Base RPC is rate limited. Try again shortly.",
      } satisfies Partial<SavingsActionError>);
      expect(attempts).toBe(2);
    }
  });

  test("maps account capability and source simulation failures to Save-specific safe errors", async () => {
    const capabilityFailure = createPrepareSavingsAction({
      readState: async () => baseState,
      simulateBatch: async () => {
        throw new CoinbaseSmartAccountBatchSimulationError(
          "borrow implementation detail",
          "account-capability",
        );
      },
    });
    await expect(capabilityFailure({
      session,
      action: { kind: "deposit", vaultAddress: VAULT, amountBaseUnits: "1500000" },
    })).rejects.toMatchObject({
      reason: "unavailable",
      message: "Savings actions require a deployed Coinbase smart account that supports ordered batch simulation.",
    } satisfies Partial<SavingsActionError>);

    const sourceFailure = createPrepareSavingsAction({
      readState: async () => baseState,
      simulateBatch: async () => {
        throw new CoinbaseSmartAccountBatchSimulationError(
          "The Base source block changed during batch simulation.",
        );
      },
    });
    await expect(sourceFailure({
      session,
      action: { kind: "withdraw", vaultAddress: VAULT, amountBaseUnits: "1500000" },
    })).rejects.toMatchObject({
      reason: "rpc",
      message: "The savings action could not be simulated safely against the pinned Base state.",
    } satisfies Partial<SavingsActionError>);
  });
});
