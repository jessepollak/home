import { describe, expect, test } from "bun:test";
import {
  BaseAccountConnectorError,
  connectWithBaseProvider,
  restoreWithBaseProvider,
  utf8MessageToHex,
} from "./base-account-connector";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const OTHER_ADDRESS = "0x2222222222222222222222222222222222222222";

type EventName = "accountsChanged" | "chainChanged" | "disconnect";

class ProviderFixture {
  accounts = [ADDRESS];
  chainId = "0x2105";
  signature: unknown = "0x1234";
  typedSignature: unknown = `0x${"cd".repeat(65)}`;
  transactionHash: unknown = `0x${"ab".repeat(32)}`;
  callsId: unknown = { id: "0xfixture-call-bundle" };
  callsStatus: unknown = {
    id: "0xfixture-call-bundle",
    version: "2.0.0",
    chainId: "0x2105",
    atomic: true,
    status: 200,
    receipts: [{ transactionHash: `0x${"ab".repeat(32)}` }],
  };
  emitAccountsDuringConnect = false;
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

  emit(event: EventName, value?: unknown) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(value as never);
    }
  }

  async request(args: {
    method: string;
    params?: readonly unknown[] | object;
  }): Promise<unknown> {
    this.requests.push(args);
    switch (args.method) {
      case "wallet_switchEthereumChain":
        return null;
      case "eth_requestAccounts":
        if (this.emitAccountsDuringConnect) {
          this.emit("accountsChanged", this.accounts);
        }
        return this.accounts;
      case "eth_accounts":
        return this.accounts;
      case "eth_chainId":
        return this.chainId;
      case "personal_sign":
        return this.signature;
      case "eth_signTypedData_v4":
        return this.typedSignature;
      case "eth_sendTransaction":
        return this.transactionHash;
      case "wallet_sendCalls":
        return this.callsId;
      case "wallet_getCallsStatus":
        return this.callsStatus;
      default:
        throw new Error("unexpected provider request");
    }
  }

  async disconnect() {}
}

function asProvider(provider: ProviderFixture) {
  return provider as unknown as Parameters<typeof connectWithBaseProvider>[0];
}

describe("Base Account connector boundary", () => {
  test("requests Base 8453, keeps the universal account, and signs the exact UTF-8 message", async () => {
    const provider = new ProviderFixture();
    provider.emitAccountsDuringConnect = true;
    const invalidations: string[] = [];
    const connection = await connectWithBaseProvider(
      asProvider(provider),
      (reason) => invalidations.push(reason),
    );

    expect(connection.address).toBe(ADDRESS);
    expect(provider.requests.slice(0, 3)).toEqual([
      {
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x2105" }],
      },
      { method: "eth_requestAccounts" },
      { method: "eth_chainId" },
    ]);

    const message = "home.example wants you to sign in\nUnicode: ₿";
    expect(utf8MessageToHex(message)).toBe(
      `0x${Buffer.from(message, "utf8").toString("hex")}`,
    );
    await expect(connection.signMessage(message)).resolves.toBe("0x1234");
    expect(
      provider.requests.find((request) => request.method === "personal_sign"),
    ).toEqual({
      method: "personal_sign",
      params: [utf8MessageToHex(message), ADDRESS],
    });
    expect(invalidations).toEqual([]);

    const permit = { primaryType: "PermitTransferFrom", domain: { name: "Permit2" } };
    await expect(connection.signTypedData(permit)).resolves.toBe(`0x${"cd".repeat(65)}`);
    expect(
      provider.requests.find((request) => request.method === "eth_signTypedData_v4"),
    ).toEqual({
      method: "eth_signTypedData_v4",
      params: [ADDRESS, JSON.stringify(permit)],
    });
  });

  test("sends only from the verified universal account and rechecks account and chain around signing", async () => {
    const provider = new ProviderFixture();
    const connection = await connectWithBaseProvider(asProvider(provider), () => {});
    const hash = await connection.sendTransaction?.({
      to: OTHER_ADDRESS,
      value: BigInt(15),
      data: "0x1234",
    });

    expect(hash).toBe(`0x${"ab".repeat(32)}`);
    expect(
      provider.requests.find((request) => request.method === "eth_sendTransaction"),
    ).toEqual({
      method: "eth_sendTransaction",
      params: [
        {
          from: ADDRESS,
          to: OTHER_ADDRESS,
          value: "0xf",
          data: "0x1234",
        },
      ],
    });
    expect(
      provider.requests.filter((request) => request.method === "eth_accounts"),
    ).toHaveLength(2);
    expect(
      provider.requests.filter((request) => request.method === "eth_chainId"),
    ).toHaveLength(3);
  });

  test("submits approval plus action as one required-atomic call bundle and recovers its transaction", async () => {
    const provider = new ProviderFixture();
    const connection = await connectWithBaseProvider(asProvider(provider), () => {});
    const calls = [
      { to: OTHER_ADDRESS as `0x${string}`, value: BigInt(0), data: "0x095ea7b3" as `0x${string}` },
      { to: ADDRESS as `0x${string}`, value: BigInt(0), data: "0x1234" as `0x${string}` },
    ];

    let walletCallsSeenByGuard = -1;
    await expect(connection.sendCalls?.(calls, "action-id", async () => {
      walletCallsSeenByGuard = provider.requests.filter(
        ({ method }) => method === "wallet_sendCalls",
      ).length;
    })).resolves.toBe("0xfixture-call-bundle");
    expect(walletCallsSeenByGuard).toBe(0);
    expect(provider.requests.find(({ method }) => method === "wallet_sendCalls")).toEqual({
      method: "wallet_sendCalls",
      params: [{
        version: "2.0.0",
        chainId: "0x2105",
        from: ADDRESS,
        atomicRequired: true,
        id: "action-id",
        calls: [
          { to: OTHER_ADDRESS, value: "0x0", data: "0x095ea7b3" },
          { to: ADDRESS, value: "0x0", data: "0x1234" },
        ],
      }],
    });
    await expect(connection.getCallsStatus?.("0xfixture-call-bundle")).resolves.toEqual({
      status: "complete",
      transactionHash: `0x${"ab".repeat(32)}`,
    });

    const expired = new Error("expired before dispatch");
    await expect(connection.sendCalls?.(calls, "expired-action", async () => {
      throw expired;
    })).rejects.toBe(expired);
    expect(
      provider.requests.filter(({ method }) => method === "wallet_sendCalls"),
    ).toHaveLength(1);
  });

  test("rejects mismatched or failed Base bundle recovery evidence", async () => {
    const provider = new ProviderFixture();
    const connection = await connectWithBaseProvider(asProvider(provider), () => {});

    provider.callsStatus = {
      id: "different-bundle",
      version: "2.0.0",
      chainId: "0x2105",
      atomic: true,
      status: 200,
      receipts: [{ transactionHash: `0x${"ab".repeat(32)}` }],
    };
    await expect(connection.getCallsStatus?.("0xfixture-call-bundle")).rejects.toMatchObject({
      reason: "invalid-provider-response",
    });

    provider.callsStatus = {
      id: "0xfixture-call-bundle",
      version: "2.0.0",
      chainId: "0x2105",
      atomic: true,
      status: 500,
      receipts: [{ transactionHash: `0x${"ab".repeat(32)}` }],
    };
    await expect(connection.getCallsStatus?.("0xfixture-call-bundle")).resolves.toEqual({
      status: "failed",
    });

    provider.callsStatus = {
      id: "0xfixture-call-bundle",
      version: "2.0.0",
      chainId: "0x2105",
      atomic: false,
      status: 200,
      receipts: [{ transactionHash: `0x${"ab".repeat(32)}` }],
    };
    await expect(connection.getCallsStatus?.("0xfixture-call-bundle")).rejects.toMatchObject({
      reason: "invalid-provider-response",
    });
  });

  test("restores only a cached Base account and chain without interactive provider methods", async () => {
    const provider = new ProviderFixture();
    const connection = await restoreWithBaseProvider(asProvider(provider), () => {});

    expect(connection.address).toBe(ADDRESS);
    expect(provider.requests).toEqual([
      { method: "eth_accounts" },
      { method: "eth_chainId" },
    ]);
    expect(
      provider.requests.some(({ method }) =>
        [
          "eth_requestAccounts",
          "wallet_switchEthereumChain",
          "personal_sign",
        ].includes(method),
      ),
    ).toBe(false);
  });

  test("maps a provider rejection to a canceled connection", async () => {
    const provider = new ProviderFixture();
    provider.request = async () => {
      throw { code: 4001, message: "fixture rejection" };
    };

    await expect(
      connectWithBaseProvider(asProvider(provider), () => {}),
    ).rejects.toEqual(
      expect.objectContaining({
        reason: "cancelled",
      }) as BaseAccountConnectorError,
    );
  });

  test("rejects account and chain changes before verification can continue", async () => {
    const accountProvider = new ProviderFixture();
    const accountConnection = await connectWithBaseProvider(
      asProvider(accountProvider),
      () => {},
    );
    accountProvider.accounts = [OTHER_ADDRESS];
    accountProvider.emit("accountsChanged", [OTHER_ADDRESS]);
    await expect(accountConnection.assertUnchanged()).rejects.toMatchObject({
      reason: "account-changed",
    });

    const chainProvider = new ProviderFixture();
    const chainConnection = await connectWithBaseProvider(
      asProvider(chainProvider),
      () => {},
    );
    chainProvider.chainId = "0x1";
    chainProvider.emit("chainChanged", "0x1");
    await expect(chainConnection.assertUnchanged()).rejects.toMatchObject({
      reason: "chain-changed",
    });
  });

  test("rejects malformed signatures instead of forwarding them to CDP", async () => {
    const provider = new ProviderFixture();
    provider.signature = "not-hex";
    const connection = await connectWithBaseProvider(
      asProvider(provider),
      () => {},
    );

    await expect(connection.signMessage("fixture")).rejects.toMatchObject({
      reason: "invalid-provider-response",
    });
  });
});
