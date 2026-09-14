import { describe, expect, test } from "bun:test";
import {
  BaseAccountConnectorError,
  connectWithBaseProvider,
  restoreWithBaseProvider,
} from "./base-account-connector";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const OTHER_ADDRESS = "0x2222222222222222222222222222222222222222";
const CHALLENGE = {
  nonce: "a".repeat(48),
  chainId: 8453,
  domain: "home.example",
  uri: "https://home.example",
  version: "1",
  statement: "Sign in to Home.",
  issuedAt: "2026-09-13T12:00:00.000Z",
  expirationTime: "2026-09-13T12:05:00.000Z",
} as const;

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
  walletConnectError: unknown = null;
  signInCapability: unknown = { message: "signed SIWE message", signature: "0x1234" };
  personalSignError: unknown = null;
  disconnects = 0;
  accountsAfterSendCalls: string[] | null = null;
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
      case "wallet_connect":
        if (this.walletConnectError) throw this.walletConnectError;
        if (this.emitAccountsDuringConnect) this.emit("accountsChanged", this.accounts);
        return {
          accounts: this.accounts.map((address) => ({
            address,
            capabilities: { signInWithEthereum: this.signInCapability },
          })),
        };
      case "eth_requestAccounts":
        return this.accounts;
      case "eth_accounts":
        return this.accounts;
      case "eth_chainId":
        return this.chainId;
      case "personal_sign":
        if (this.personalSignError) throw this.personalSignError;
        return this.signature;
      case "eth_signTypedData_v4":
        return this.typedSignature;
      case "wallet_sendCalls": {
        const result = this.callsId;
        if (this.accountsAfterSendCalls) this.accounts = this.accountsAfterSendCalls;
        return result;
      }
      case "wallet_getCallsStatus":
        return this.callsStatus;
      default:
        throw new Error("unexpected provider request");
    }
  }

  async disconnect() { this.disconnects += 1; }
}

function asProvider(provider: ProviderFixture) {
  return provider as unknown as Parameters<typeof connectWithBaseProvider>[0];
}

describe("Base Account connector boundary", () => {
  test("uses wallet_connect SIWE as one approval without account or personal-sign fallback", async () => {
    const provider = new ProviderFixture();
    provider.emitAccountsDuringConnect = true;
    const invalidations: string[] = [];
    const connection = await connectWithBaseProvider(
      asProvider(provider),
      CHALLENGE,
      (reason) => invalidations.push(reason),
    );

    expect(connection).toMatchObject({
      kind: "proof",
      address: ADDRESS,
      message: "signed SIWE message",
      signature: "0x1234",
    });
    expect(provider.requests).toEqual([
      {
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x2105" }],
      },
      {
        method: "wallet_connect",
        params: [{
          version: "1",
          capabilities: {
            signInWithEthereum: {
              nonce: CHALLENGE.nonce,
              chainId: "0x2105",
              domain: CHALLENGE.domain,
              uri: CHALLENGE.uri,
              version: "1",
              statement: CHALLENGE.statement,
              issuedAt: CHALLENGE.issuedAt,
              expirationTime: CHALLENGE.expirationTime,
            },
          },
        }],
      },
      { method: "eth_chainId" },
    ]);
    expect(provider.requests.some(({ method }) =>
      method === "eth_requestAccounts" || method === "personal_sign"
    )).toBe(false);
    expect(invalidations).toEqual([]);
  });

  test("submits approval plus action as one required-atomic call bundle and recovers its transaction", async () => {
    const provider = new ProviderFixture();
    const connection = await connectWithBaseProvider(asProvider(provider), CHALLENGE, () => {});
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

  test("returns the Base submission handle before a later account-state read could discard it", async () => {
    const provider = new ProviderFixture();
    provider.accountsAfterSendCalls = [OTHER_ADDRESS];
    const connection = await connectWithBaseProvider(asProvider(provider), CHALLENGE, () => {});

    const submissionId = await connection.sendCalls?.([
      { to: OTHER_ADDRESS, value: BigInt(0), data: "0x1234" },
    ], "action-id");
    const evidenceUpload = submissionId ? { submissionId } : null;
    expect(evidenceUpload).toEqual({ submissionId: "0xfixture-call-bundle" });
    expect(
      provider.requests.filter(({ method }) => method === "wallet_sendCalls"),
    ).toHaveLength(1);
    expect(
      provider.requests.filter(({ method }) => method === "eth_accounts"),
    ).toHaveLength(1);
    await expect(connection.assertUnchanged()).rejects.toMatchObject({
      reason: "account-changed",
    });
  });

  test("rejects mismatched or failed Base bundle recovery evidence", async () => {
    const provider = new ProviderFixture();
    const connection = await connectWithBaseProvider(asProvider(provider), CHALLENGE, () => {});

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

  test("types only a successful empty restoration read as a missing connection", async () => {
    const provider = new ProviderFixture();
    provider.accounts = [];

    await expect(
      restoreWithBaseProvider(asProvider(provider), () => {}),
    ).rejects.toMatchObject({ reason: "missing-connection" });
    expect(provider.requests).toEqual([{ method: "eth_accounts" }]);

    await expect(
      connectWithBaseProvider(asProvider(provider), CHALLENGE, () => {}),
    ).rejects.toMatchObject({ reason: "invalid-provider-response" });
  });

  test("rejects a wallet_connect response with multiple accounts without fallback", async () => {
    const provider = new ProviderFixture();
    provider.accounts = [ADDRESS, OTHER_ADDRESS];

    await expect(
      connectWithBaseProvider(asProvider(provider), CHALLENGE, () => {}),
    ).rejects.toMatchObject({ reason: "invalid-provider-response" });
    expect(provider.requests.some(({ method }) => method === "eth_requestAccounts")).toBe(false);
    expect(provider.disconnects).toBe(1);
  });

  test("keeps thrown and malformed restoration reads retryable instead of typing them as missing", async () => {
    const thrownProvider = new ProviderFixture();
    thrownProvider.request = async () => {
      throw new Error("fixture transport failure");
    };
    await expect(
      restoreWithBaseProvider(asProvider(thrownProvider), () => {}),
    ).rejects.toMatchObject({ reason: "invalid-provider-response" });

    for (const malformedAccounts of [null, {}, ["not-an-address"]]) {
      const malformedProvider = new ProviderFixture();
      malformedProvider.request = async ({ method }) =>
        method === "eth_accounts" ? malformedAccounts : "0x2105";
      await expect(
        restoreWithBaseProvider(asProvider(malformedProvider), () => {}),
      ).rejects.toMatchObject({ reason: "invalid-provider-response" });
    }

    const malformedChainProvider = new ProviderFixture();
    malformedChainProvider.chainId = "not-a-chain";
    await expect(
      restoreWithBaseProvider(asProvider(malformedChainProvider), () => {}),
    ).rejects.toMatchObject({ reason: "invalid-provider-response" });
  });

  test("falls back only for explicit method or capability unsupported codes", async () => {
    for (const code of [4200, -32601, -32004]) {
      const methodProvider = new ProviderFixture();
      methodProvider.walletConnectError = { code, message: "unsupported" };
      const methodFallback = await connectWithBaseProvider(asProvider(methodProvider), CHALLENGE, () => {});
      expect(methodFallback.kind).toBe("unsupported");
      expect(methodProvider.requests.map(({ method }) => method)).toEqual([
        "wallet_switchEthereumChain",
        "wallet_connect",
        "eth_requestAccounts",
        "eth_chainId",
      ]);

      const capabilityProvider = new ProviderFixture();
      capabilityProvider.signInCapability = { code, message: "unsupported capability" };
      const capabilityFallback = await connectWithBaseProvider(asProvider(capabilityProvider), CHALLENGE, () => {});
      expect(capabilityFallback.kind).toBe("unsupported");
      expect(capabilityFallback.address).toBe(ADDRESS);
      expect(capabilityProvider.requests.some(({ method }) => method === "eth_requestAccounts")).toBe(false);
      await expect(capabilityFallback.signMessage("fallback message")).resolves.toBe("0x1234");
      expect(capabilityProvider.requests.filter(({ method }) => method === "personal_sign")).toHaveLength(1);
    }
  });

  test("disconnects after a method-level fallback connects but later chain validation fails", async () => {
    const provider = new ProviderFixture();
    provider.walletConnectError = { code: 4200, message: "unsupported" };
    provider.chainId = "0x1";

    await expect(
      connectWithBaseProvider(asProvider(provider), CHALLENGE, () => {}),
    ).rejects.toMatchObject({ reason: "chain-changed" });
    expect(provider.requests.map(({ method }) => method)).toEqual([
      "wallet_switchEthereumChain",
      "wallet_connect",
      "eth_requestAccounts",
      "eth_chainId",
    ]);
    expect(provider.disconnects).toBe(1);
  });

  test("cancels only explicit rejection codes and fails closed for every other response", async () => {
    for (const code of [4001, 5000]) {
      for (const capability of [false, true]) {
        const provider = new ProviderFixture();
        if (capability) provider.signInCapability = { code, message: "rejected" };
        else provider.walletConnectError = { code, message: "rejected" };
        await expect(
          connectWithBaseProvider(asProvider(provider), CHALLENGE, () => {}),
        ).rejects.toEqual(expect.objectContaining({ reason: "cancelled" }) as BaseAccountConnectorError);
        expect(provider.requests.some(({ method }) => method === "eth_requestAccounts")).toBe(false);
        if (capability) expect(provider.disconnects).toBe(1);
      }
    }

    for (const code of [4001, 5000]) {
      const provider = new ProviderFixture();
      provider.signInCapability = { code: 4200, message: "unsupported capability" };
      provider.personalSignError = { code, message: "rejected signing" };
      const fallback = await connectWithBaseProvider(asProvider(provider), CHALLENGE, () => {});
      await expect(fallback.signMessage("fallback message")).rejects.toMatchObject({ reason: "cancelled" });
    }

    for (const signInCapability of [
      undefined,
      null,
      {},
      { message: "missing signature" },
      { code: 4200 },
      { code: 4200, message: "ambiguous", signature: "0x1234" },
      { code: 4100, message: "unauthorized" },
    ]) {
      const provider = new ProviderFixture();
      provider.signInCapability = signInCapability;
      await expect(
        connectWithBaseProvider(asProvider(provider), CHALLENGE, () => {}),
      ).rejects.toMatchObject({ reason: "invalid-provider-response" });
      expect(provider.requests.some(({ method }) => method === "eth_requestAccounts")).toBe(false);
      expect(provider.disconnects).toBe(1);
    }

    for (const error of [
      new Error("malformed"),
      { code: "4200" },
      { code: 4200 },
      { code: 4100, message: "unauthorized" },
    ]) {
      const provider = new ProviderFixture();
      provider.walletConnectError = error;
      await expect(
        connectWithBaseProvider(asProvider(provider), CHALLENGE, () => {}),
      ).rejects.toMatchObject({ reason: "invalid-provider-response" });
      expect(provider.requests.some(({ method }) => method === "eth_requestAccounts")).toBe(false);
    }
  });

  test("rejects account and chain changes before verification can continue", async () => {
    const accountProvider = new ProviderFixture();
    const accountConnection = await connectWithBaseProvider(
      asProvider(accountProvider),
      CHALLENGE,
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
      CHALLENGE,
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
      CHALLENGE,
      () => {},
    );

    await expect(connection.signMessage("fixture")).rejects.toMatchObject({
      reason: "invalid-provider-response",
    });
  });
});
