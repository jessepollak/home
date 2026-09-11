import { describe, expect, test } from "bun:test";
import {
  BaseAccountConnectorError,
  connectWithBaseProvider,
} from "./base-account-connector";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const OTHER_ADDRESS = "0x2222222222222222222222222222222222222222";
const ACTION_ID = "11111111-1111-4111-8111-111111111111";
const WALLET_HEX_ID =
  "0x00000000000000000000000000000000000000000000000000000000000000000e670ec64341771606e55d6b4ca35a1a6b75ee3d5145a99d05921026d1527331";
const CALL = {
  to: OTHER_ADDRESS as `0x${string}`,
  value: BigInt(0),
  data: "0x1234" as `0x${string}`,
};

type EventName = "accountsChanged" | "chainChanged" | "disconnect";

class RpcError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Controlled unfunded provider for #176. Two modes:
 * - `echo-request-id`: EIP-5792-faithful (honor/echo app `id`, reject duplicates).
 * - `wallet-generated-id`: Base Account-shaped (return a distinct hex handle).
 */
class Eip5792ProviderFixture {
  mode: "echo-request-id" | "wallet-generated-id" = "wallet-generated-id";
  sendCallsError: RpcError | null = null;
  getCallsStatusError: RpcError | null = null;
  acceptedIds = new Set<string>();
  requests: { method: string; params?: readonly unknown[] | object }[] = [];
  listeners = new Map<EventName, Set<(value: never) => void>>();

  on(event: EventName, listener: (value: never) => void) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  removeListener(event: EventName, listener: (value: never) => void) {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  async disconnect() {}

  async request(args: {
    method: string;
    params?: readonly unknown[] | object;
  }): Promise<unknown> {
    this.requests.push(args);
    switch (args.method) {
      case "wallet_switchEthereumChain":
        return null;
      case "eth_requestAccounts":
      case "eth_accounts":
        return [ADDRESS];
      case "eth_chainId":
        return "0x2105";
      case "wallet_sendCalls": {
        if (this.sendCallsError) throw this.sendCallsError;
        const params = Array.isArray(args.params) ? args.params[0] : null;
        const requestId =
          params && typeof params === "object" && "id" in params && typeof params.id === "string"
            ? params.id
            : "";
        if (requestId && this.acceptedIds.has(requestId)) {
          throw new RpcError(5720, "There is already a bundle submitted with this id");
        }
        if (requestId) this.acceptedIds.add(requestId);
        return this.mode === "echo-request-id" ? { id: requestId } : { id: WALLET_HEX_ID };
      }
      case "wallet_getCallsStatus": {
        if (this.getCallsStatusError) throw this.getCallsStatusError;
        const submissionId = Array.isArray(args.params) ? args.params[0] : null;
        const known =
          submissionId === WALLET_HEX_ID ||
          (this.mode === "echo-request-id" && this.acceptedIds.has(String(submissionId)));
        if (!known) {
          throw new RpcError(5730, "This bundle id is unknown / has not been submitted");
        }
        return {
          id: submissionId,
          version: "2.0.0",
          chainId: "0x2105",
          atomic: true,
          status: 200,
          receipts: [{ transactionHash: `0x${"ab".repeat(32)}` }],
        };
      }
      default:
        throw new Error(`unexpected provider request ${args.method}`);
    }
  }
}

function asProvider(provider: Eip5792ProviderFixture) {
  return provider as unknown as Parameters<typeof connectWithBaseProvider>[0];
}

describe("EIP-5792 / Base Account request-id recovery fixtures (#176)", () => {
  test("sends the Home action id as request id and keeps a distinct wallet-returned handle", async () => {
    const provider = new Eip5792ProviderFixture();
    const connection = await connectWithBaseProvider(asProvider(provider), () => {});

    const submissionId = await connection.sendCalls?.([CALL], ACTION_ID);
    expect(submissionId).toBe(WALLET_HEX_ID);
    expect(submissionId).not.toBe(ACTION_ID);
    expect(provider.requests.find(({ method }) => method === "wallet_sendCalls")).toEqual({
      method: "wallet_sendCalls",
      params: [{
        version: "2.0.0",
        chainId: "0x2105",
        from: ADDRESS,
        atomicRequired: true,
        id: ACTION_ID,
        calls: [{ to: OTHER_ADDRESS, value: "0x0", data: "0x1234" }],
      }],
    });

    await expect(connection.getCallsStatus?.(WALLET_HEX_ID)).resolves.toEqual({
      status: "complete",
      transactionHash: `0x${"ab".repeat(32)}`,
    });
    await expect(connection.getCallsStatus?.(ACTION_ID)).rejects.toMatchObject({
      reason: "invalid-provider-response",
    });
  });

  test("can recover via the request id only when the wallet echoes it", async () => {
    const provider = new Eip5792ProviderFixture();
    provider.mode = "echo-request-id";
    const connection = await connectWithBaseProvider(asProvider(provider), () => {});

    await expect(connection.sendCalls?.([CALL], ACTION_ID)).resolves.toBe(ACTION_ID);
    await expect(connection.getCallsStatus?.(ACTION_ID)).resolves.toEqual({
      status: "complete",
      transactionHash: `0x${"ab".repeat(32)}`,
    });
  });

  test("maps duplicate-id 5720 to invalid-provider-response, not cancelled", async () => {
    const provider = new Eip5792ProviderFixture();
    const connection = await connectWithBaseProvider(asProvider(provider), () => {});

    await connection.sendCalls?.([CALL], ACTION_ID);
    await expect(connection.sendCalls?.([CALL], ACTION_ID)).rejects.toEqual(
      expect.objectContaining({
        reason: "invalid-provider-response",
      }) as BaseAccountConnectorError,
    );
    expect(
      provider.requests.filter(({ method }) => method === "wallet_sendCalls"),
    ).toHaveLength(2);
  });

  test("maps user rejection 4001 to cancelled and other EIP-5792 lookup codes to invalid-provider-response", async () => {
    const rejected = new Eip5792ProviderFixture();
    rejected.sendCallsError = new RpcError(4001, "User rejected the request");
    const rejectedConnection = await connectWithBaseProvider(asProvider(rejected), () => {});
    await expect(rejectedConnection.sendCalls?.([CALL], ACTION_ID)).rejects.toMatchObject({
      reason: "cancelled",
    });

    for (const code of [5730, 4200, -32602]) {
      const provider = new Eip5792ProviderFixture();
      provider.getCallsStatusError = new RpcError(code, `lookup ${code}`);
      const connection = await connectWithBaseProvider(asProvider(provider), () => {});
      await expect(connection.getCallsStatus?.(WALLET_HEX_ID)).rejects.toMatchObject({
        reason: "invalid-provider-response",
      });
    }
  });

  test("does not treat a preallocated request id as a submission handle when dispatch never starts", async () => {
    const provider = new Eip5792ProviderFixture();
    const connection = await connectWithBaseProvider(asProvider(provider), () => {});
    const expired = new Error("expired before dispatch");

    await expect(connection.sendCalls?.([CALL], ACTION_ID, async () => {
      throw expired;
    })).rejects.toBe(expired);
    expect(
      provider.requests.filter(({ method }) => method === "wallet_sendCalls"),
    ).toHaveLength(0);
    expect(provider.acceptedIds.size).toBe(0);
    await expect(connection.getCallsStatus?.(ACTION_ID)).rejects.toMatchObject({
      reason: "invalid-provider-response",
    });
  });
});
