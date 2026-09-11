import { describe, expect, test } from "bun:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  type Address,
  type Hex,
} from "viem";
import { entryPoint06Abi, entryPoint06Address } from "viem/account-abstraction";
import { createTransferReceiptHandler } from "@/server/transfers/handler";
import {
  createTransferReceiptReader,
  normalizeTransactionHash,
} from "./receipt";

const HASH = `0x${"ab".repeat(32)}` as const;
const USER_OP_HASH = `0x${"cd".repeat(32)}` as const;
const SENDER = "0x1111111111111111111111111111111111111111" as const;
const ENTRY_POINT = "0x0000000071727de22e5e9d8baf0edac6f37da032";
const PAYMASTER = "0x4444444444444444444444444444444444444444" as const;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

function operationLog({
  success,
  address = ENTRY_POINT,
  userOperationHash = USER_OP_HASH,
  sender = SENDER,
  paymaster = ZERO_ADDRESS,
  nonce = BigInt(0),
}: {
  success: boolean;
  address?: Address;
  userOperationHash?: Hex;
  sender?: Address;
  paymaster?: Address;
  nonce?: bigint;
}) {
  return {
    address,
    topics: encodeEventTopics({
      abi: entryPoint06Abi,
      eventName: "UserOperationEvent",
      args: { userOpHash: userOperationHash, sender, paymaster },
    }),
    data: encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "bool" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [nonce, success, BigInt(2), BigInt(3)],
    ),
  };
}

const ACCOUNT_ABI = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

function embeddedTransactionInput(target = "0x2222222222222222222222222222222222222222") {
  return bundledTransactionInput([target]);
}

function bundledTransactionInput(
  targets: string[],
  paymasterAndData: Hex[] = targets.map(() => "0x" as const),
) {
  return encodeFunctionData({
    abi: entryPoint06Abi,
    functionName: "handleOps",
    args: [targets.map((target, index) => ({
      sender: SENDER,
      nonce: BigInt(index),
      initCode: "0x" as const,
      callData: encodeFunctionData({
        abi: ACCOUNT_ABI,
        functionName: "execute",
        args: [target as `0x${string}`, BigInt(7), "0x1234"],
      }),
      callGasLimit: BigInt(1),
      verificationGasLimit: BigInt(1),
      preVerificationGas: BigInt(1),
      maxFeePerGas: BigInt(1),
      maxPriorityFeePerGas: BigInt(1),
      paymasterAndData: paymasterAndData[index],
      signature: "0x" as const,
    })), SENDER],
  });
}

describe("Base transfer receipt boundary", () => {
  test("accepts pending then confirmed success receipts only from Base 8453", async () => {
    let receipt: unknown = null;
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { id: number; method: string };
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result:
          body.method === "eth_chainId"
            ? "0x2105"
            : receipt,
      });
    };
    const readReceipt = createTransferReceiptReader({
      fetchImpl,
      rpcUrl: "https://base.example",
    });

    await expect(readReceipt(HASH)).resolves.toEqual({
      status: "pending",
      transactionHash: HASH,
    });

    receipt = {
      transactionHash: HASH,
      blockNumber: "0x10",
      status: "0x1",
    };
    await expect(readReceipt(HASH)).resolves.toEqual({
      status: "confirmed",
      transactionHash: HASH,
      blockNumber: "16",
      success: true,
    });
  });

  test("requires matching EntryPoint proof for an embedded user operation", async () => {
    let logs: unknown[] = [operationLog({ success: true })];
    const readReceipt = createTransferReceiptReader({
      rpcUrl: "https://base.example",
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { id: number; method: string };
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: body.method === "eth_chainId"
            ? "0x2105"
            : {
                transactionHash: HASH,
                blockNumber: "0x10",
                status: "0x1",
                logs,
              },
        });
      },
    });

    await expect(
      readReceipt(HASH, { userOperationHash: USER_OP_HASH, sender: SENDER }),
    ).resolves.toMatchObject({ status: "confirmed", success: true });

    logs = [operationLog({ success: false })];
    await expect(
      readReceipt(HASH, { userOperationHash: USER_OP_HASH, sender: SENDER }),
    ).resolves.toMatchObject({ status: "confirmed", success: false });

    for (const mismatchedLog of [
      operationLog({
        success: true,
        sender: "0x2222222222222222222222222222222222222222",
      }),
      operationLog({
        success: true,
        userOperationHash: `0x${"ef".repeat(32)}`,
      }),
    ]) {
      logs = [mismatchedLog];
      await expect(
        readReceipt(HASH, { userOperationHash: USER_OP_HASH, sender: SENDER }),
      ).resolves.toEqual({
        status: "unresolved",
        transactionHash: HASH,
        reason: "operation-proof-missing",
      });
    }
  });

  test("binds money confirmation to exact claimed calls and claimed-time evidence", async () => {
    let input = embeddedTransactionInput();
    let timestamp = "0x64";
    const readReceipt = createTransferReceiptReader({
      rpcUrl: "https://base.example",
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { id: number; method: string };
        const result = body.method === "eth_chainId"
          ? "0x2105"
          : body.method === "eth_getTransactionReceipt"
            ? {
                transactionHash: HASH,
                blockNumber: "0x10",
                status: "0x1",
                logs: [operationLog({ success: true, address: entryPoint06Address })],
              }
            : body.method === "eth_getTransactionByHash"
              ? {
                  hash: HASH,
                  from: "0x3333333333333333333333333333333333333333",
                  to: entryPoint06Address,
                  value: "0x0",
                  input,
                }
              : { timestamp };
        return Response.json({ jsonrpc: "2.0", id: body.id, result });
      },
    });
    const proof = {
      accountProvider: "cdp-embedded" as const,
      sender: SENDER,
      userOperationHash: USER_OP_HASH,
      expectedCalls: [{
        to: "0x2222222222222222222222222222222222222222" as const,
        value: "7",
        data: "0x1234" as const,
      }],
      notBefore: "1970-01-01T00:01:39.000Z",
    };

    await expect(readReceipt(HASH, proof)).resolves.toMatchObject({
      status: "confirmed",
      success: true,
    });

    input = embeddedTransactionInput("0x4444444444444444444444444444444444444444");
    await expect(readReceipt(HASH, proof)).resolves.toEqual({
      status: "unresolved",
      transactionHash: HASH,
      reason: "operation-mismatch",
    });

    input = embeddedTransactionInput();
    timestamp = "0x62";
    await expect(readReceipt(HASH, proof)).resolves.toEqual({
      status: "unresolved",
      transactionHash: HASH,
      reason: "operation-too-old",
    });
  });

  test("uses the embedded hash and nonce to distinguish identical calls in one bundle", async () => {
    const secondUserOpHash = `0x${"ef".repeat(32)}` as const;
    const sharedTarget = "0x2222222222222222222222222222222222222222" as const;
    const input = bundledTransactionInput(
      [sharedTarget, sharedTarget],
      ["0x", PAYMASTER],
    );
    const readReceipt = createTransferReceiptReader({
      rpcUrl: "https://base.example",
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { id: number; method: string };
        const result = body.method === "eth_chainId"
          ? "0x2105"
          : body.method === "eth_getTransactionReceipt"
            ? {
                transactionHash: HASH,
                blockNumber: "0x10",
                status: "0x1",
                logs: [
                  operationLog({
                    success: false,
                    address: entryPoint06Address,
                  }),
                  operationLog({
                    success: true,
                    address: entryPoint06Address,
                    userOperationHash: secondUserOpHash,
                    paymaster: PAYMASTER,
                    nonce: BigInt(1),
                  }),
                ],
              }
            : body.method === "eth_getTransactionByHash"
              ? {
                  hash: HASH,
                  from: "0x3333333333333333333333333333333333333333",
                  to: entryPoint06Address,
                  value: "0x0",
                  input,
                }
              : { timestamp: "0x64" };
        return Response.json({ jsonrpc: "2.0", id: body.id, result });
      },
    });

    await expect(readReceipt(HASH, {
      accountProvider: "cdp-embedded",
      sender: SENDER,
      userOperationHash: secondUserOpHash,
      expectedCalls: [{ to: sharedTarget, value: "7", data: "0x1234" }],
      notBefore: "1970-01-01T00:01:39.000Z",
    })).resolves.toMatchObject({
      status: "confirmed",
      success: true,
      verifiedExecution: {
        chainId: 8453,
        kind: "user-operation",
        hash: secondUserOpHash,
      },
    });

    await expect(readReceipt(HASH, {
      accountProvider: "base-account",
      sender: SENDER,
      expectedCalls: [{ to: sharedTarget, value: "7", data: "0x1234" }],
      notBefore: "1970-01-01T00:01:39.000Z",
    })).resolves.toEqual({
      status: "unresolved",
      transactionHash: HASH,
      reason: "operation-proof-missing",
    });
  });

  test("rejects malformed hashes and a receipt from the wrong transaction", async () => {
    expect(() => normalizeTransactionHash("0x1234")).toThrow();
    const readReceipt = createTransferReceiptReader({
      rpcUrl: "https://base.example",
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { id: number; method: string };
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result:
            body.method === "eth_chainId"
              ? "0x2105"
              : {
                  transactionHash: `0x${"cd".repeat(32)}`,
                  blockNumber: "0x10",
                  status: "0x1",
                },
        });
      },
    });
    await expect(readReceipt(HASH)).rejects.toThrow("mismatched receipt");
  });

  test("requires authentication before reading and keeps responses private", async () => {
    let reads = 0;
    const unauthorized = createTransferReceiptHandler({
      authorize: async () => new Response(null, { status: 401 }),
      readReceipt: async () => {
        reads += 1;
        return { status: "pending", transactionHash: HASH };
      },
    });
    const denied = await unauthorized(
      new Request(`https://home.example/api/transfer-receipt?hash=${HASH}`),
    );
    expect(denied.status).toBe(401);
    expect(reads).toBe(0);

    const authorized = createTransferReceiptHandler({
      authorize: async () => Response.json({ verified: true }),
      readReceipt: async (hash) => {
        reads += 1;
        return { status: "pending", transactionHash: hash };
      },
    });
    const response = await authorized(
      new Request(`https://home.example/api/transfer-receipt?hash=${HASH}`),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toEqual({
      status: "pending",
      transactionHash: HASH,
    });
    expect(reads).toBe(1);
  });

  test("passes complete embedded operation proof through the authenticated handler", async () => {
    let seenProof: unknown = null;
    const authorized = createTransferReceiptHandler({
      authorize: async () => Response.json({ verified: true }),
      readReceipt: async (hash, proof) => {
        seenProof = proof;
        return { status: "pending", transactionHash: hash };
      },
    });
    const response = await authorized(
      new Request(
        `https://home.example/api/transfer-receipt?hash=${HASH}&userOpHash=${USER_OP_HASH}&sender=${SENDER}`,
      ),
    );
    expect(response.status).toBe(200);
    expect(seenProof).toEqual({ userOperationHash: USER_OP_HASH, sender: SENDER });
  });
});
