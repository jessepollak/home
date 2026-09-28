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
  emailConnectError: unknown = null;
  dataCallback: unknown = undefined;
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
        if (this.emailConnectError && JSON.stringify(args.params).includes("dataCallback")) throw this.emailConnectError;
        if (this.emitAccountsDuringConnect) this.emit("accountsChanged", this.accounts);
        return {
          accounts: this.accounts.map((address) => ({
            address,
            capabilities: {
              signInWithEthereum: this.signInCapability,
              ...(this.dataCallback === undefined ? {} : { dataCallback: this.dataCallback }),
            },
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

class EmailProviderFixture extends ProviderFixture {
  emailResult: unknown = { capabilities: { dataCallback: { email: "Person@Example.COM" } } };
  emailError: unknown = null;

  override request(args: { method: string; params?: readonly unknown[] | object }): Promise<unknown> {
    if (args.method !== "wallet_sendCalls") return super.request(args);
    this.requests.push(args);
    return this.emailError ? Promise.reject(this.emailError) : Promise.resolve(this.emailResult);
  }
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

  test("adds the aggregate gas override only to the final call and guards invalid hints", async () => {
    const provider = new ProviderFixture();
    const connection = await connectWithBaseProvider(asProvider(provider), CHALLENGE, () => {});
    const calls = [
      { to: OTHER_ADDRESS as `0x${string}`, value: BigInt(0), data: "0x095ea7b3" as `0x${string}` },
      { to: ADDRESS as `0x${string}`, value: BigInt(0), data: "0x1234" as `0x${string}` },
    ];

    await connection.sendCalls?.(calls, "hinted-action", undefined, "150000");
    const request = provider.requests.find(({ method }) => method === "wallet_sendCalls");
    const sentParams = (request?.params as Array<{ calls: unknown[]; capabilities?: unknown }> | undefined)?.[0];
    expect(sentParams).not.toHaveProperty("capabilities");
    expect(sentParams?.calls).toEqual([
      { to: OTHER_ADDRESS, value: "0x0", data: "0x095ea7b3" },
      {
        to: ADDRESS,
        value: "0x0",
        data: "0x1234",
        capabilities: { gasLimitOverride: { value: "0x249f0" } },
      },
    ]);

    const paymaster = { url: "https://example.test/api/actions/paid-action/paymaster", context: { erc20: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" } };
    await connection.sendCalls?.(calls, "paid-action", undefined, "150000", paymaster);
    const paidRequest = provider.requests.filter(({ method }) => method === "wallet_sendCalls").at(-1);
    const paidParams = (paidRequest?.params as Array<{ calls: unknown[]; capabilities?: unknown }> | undefined)?.[0];
    expect(paidParams?.capabilities).toEqual({ paymasterService: paymaster });
    expect(paidParams?.calls).toEqual([
      { to: OTHER_ADDRESS, value: "0x0", data: "0x095ea7b3" },
      { to: ADDRESS, value: "0x0", data: "0x1234", capabilities: { gasLimitOverride: { value: "0x249f0" } } },
    ]);
    for (const hint of ["0", "0x10", "2000001"]) {
      await expect(connection.sendCalls?.(calls, "bad-hint", undefined, hint)).rejects.toMatchObject({
        reason: "not-submitted",
        cause: expect.objectContaining({ reason: "invalid-provider-response" }),
      });
    }
    expect(provider.requests.filter(({ method }) => method === "wallet_sendCalls")).toHaveLength(2);
  });

  test("rejects a three-call gas hint before dispatch but sends an unhinted batch unchanged", async () => {
    const provider = new ProviderFixture();
    const connection = await connectWithBaseProvider(asProvider(provider), CHALLENGE, () => {});
    const calls = [
      { to: OTHER_ADDRESS as `0x${string}`, value: BigInt(0), data: "0x095ea7b3" as `0x${string}` },
      { to: ADDRESS as `0x${string}`, value: BigInt(0), data: "0x238d6579" as `0x${string}` },
      { to: ADDRESS as `0x${string}`, value: BigInt(0), data: "0x50d8cd4b" as `0x${string}` },
    ];
    let beforeDispatchCalls = 0;
    const beforeDispatch = async () => { beforeDispatchCalls += 1; };
    await expect(connection.sendCalls?.(calls, "hinted-action", beforeDispatch, "150000")).rejects.toMatchObject({
      reason: "not-submitted",
      cause: expect.objectContaining({ reason: "invalid-provider-response" }),
    });
    expect(beforeDispatchCalls).toBe(0);
    expect(provider.requests.filter(({ method }) => method === "wallet_sendCalls")).toHaveLength(0);

    await expect(connection.sendCalls?.(calls, "unhinted-action", beforeDispatch)).resolves.toBe("0xfixture-call-bundle");
    expect(beforeDispatchCalls).toBe(1);
    const sent = provider.requests.filter(({ method }) => method === "wallet_sendCalls");
    expect(sent).toHaveLength(1);
    const params = (sent[0]?.params as Array<{ calls: unknown[] }>)[0];
    expect(params.calls).toEqual([
      { to: OTHER_ADDRESS, value: "0x0", data: "0x095ea7b3" },
      { to: ADDRESS, value: "0x0", data: "0x238d6579" },
      { to: ADDRESS, value: "0x0", data: "0x50d8cd4b" },
    ]);
    for (const call of params.calls) expect(call).not.toHaveProperty("capabilities");
  });

  test("sends a three-call batch with an intermediate token approval and a final-call gas hint", async () => {
    const provider = new ProviderFixture();
    const connection = await connectWithBaseProvider(asProvider(provider), CHALLENGE, () => {});
    const calls = [
      { to: OTHER_ADDRESS as `0x${string}`, value: BigInt(0), data: "0x095ea7b3" as `0x${string}` },
      { to: OTHER_ADDRESS as `0x${string}`, value: BigInt(0), data: `0x095ea7b3${"0".repeat(128)}` as `0x${string}` },
      { to: ADDRESS as `0x${string}`, value: BigInt(0), data: "0x1234" as `0x${string}` },
    ];

    await expect(connection.sendCalls?.(calls, "hinted-action", undefined, "150000")).resolves.toBe("0xfixture-call-bundle");
    const sent = provider.requests.filter(({ method }) => method === "wallet_sendCalls");
    expect(sent).toHaveLength(1);
    const params = (sent[0]?.params as Array<{ calls: unknown[] }>)[0];
    expect(params.calls).toEqual([
      { to: OTHER_ADDRESS, value: "0x0", data: "0x095ea7b3" },
      { to: OTHER_ADDRESS, value: "0x0", data: calls[1].data },
      { to: ADDRESS, value: "0x0", data: "0x1234", capabilities: { gasLimitOverride: { value: "0x249f0" } } },
    ]);
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

  test("an account change before wallet_sendCalls is reported as not submitted", async () => {
    const provider = new ProviderFixture();
    const connection = await connectWithBaseProvider(asProvider(provider), CHALLENGE, () => {});
    const calls = [{ to: ADDRESS as `0x${string}`, value: BigInt(0), data: "0x1234" as `0x${string}` }];
    provider.accounts = [OTHER_ADDRESS];
    await expect(connection.sendCalls?.(calls, "changed", undefined)).rejects.toMatchObject({
      reason: "not-submitted",
      cause: expect.objectContaining({ reason: "account-changed" }),
    });
    expect(provider.requests.some(({ method }) => method === "wallet_sendCalls")).toBe(false);
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

  test("treats an unparseable changed account as an account change", async () => {
    for (const accounts of [["0xAbcdef0123456789abcdef0123456789abcdef01"], ["not-an-address"]]) {
      const provider = new ProviderFixture();
      const invalidations: string[] = [];
      const connection = await connectWithBaseProvider(
        asProvider(provider),
        CHALLENGE,
        (reason) => { invalidations.push(reason); },
      );
      provider.emit("accountsChanged", accounts);
      expect(invalidations).toEqual(["account-changed"]);
      await expect(connection.assertUnchanged()).rejects.toMatchObject({
        reason: "account-changed",
      });
    }
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

  test("asks for the email in the sign-in request only when requested", async () => {
    const plain = new ProviderFixture();
    const withoutEmail = await connectWithBaseProvider(asProvider(plain), CHALLENGE, () => {});
    expect(JSON.stringify(plain.requests)).not.toContain("dataCallback");
    expect(withoutEmail.signInEmail).toBeUndefined();

    const provider = new ProviderFixture();
    provider.dataCallback = { email: " Person@Example.COM " };
    const connection = await connectWithBaseProvider(asProvider(provider), CHALLENGE, () => {}, { requestEmail: true });
    const connect = provider.requests.find(({ method }) => method === "wallet_connect") as { params: [{ capabilities: Record<string, unknown> }] };
    expect(connect.params[0].capabilities.dataCallback).toEqual({ optional: true, requests: [{ type: "email", optional: true }] });
    expect(connect.params[0].capabilities.signInWithEthereum).toMatchObject({ nonce: CHALLENGE.nonce });
    expect(connection).toMatchObject({ kind: "proof", signature: "0x1234", signInEmail: { status: "email", email: "person@example.com" } });
  });

  test("classifies every sign-in email capability result without affecting the sign-in proof", async () => {
    const cases: [unknown, unknown][] = [
      [undefined, { status: "ignored" }],
      [{ code: 4001, message: "User rejected" }, { status: "declined" }],
      [{ code: 5000, message: "User closed" }, { status: "declined" }],
      [{}, { status: "declined" }],
      [{ code: 5700, message: "Unsupported capability" }, { status: "refused", code: 5700, message: "Unsupported capability" }],
      [{ email: "not-an-email" }, { status: "refused", code: null, message: "malformed" }],
      ["raw", { status: "refused", code: null, message: "malformed" }],
    ];
    for (const [dataCallback, expected] of cases) {
      const provider = new ProviderFixture();
      provider.dataCallback = dataCallback;
      const connection = await connectWithBaseProvider(asProvider(provider), CHALLENGE, () => {}, { requestEmail: true });
      expect(connection).toMatchObject({ kind: "proof", message: "signed SIWE message" });
      expect(connection.signInEmail).toEqual(expected as never);
    }
  });

  test("retries sign-in once without the email capability when the wallet refuses the whole request", async () => {
    for (const code of [5700, -32602]) {
      const provider = new ProviderFixture();
      provider.emailConnectError = { code, message: "capability not supported" };
      const connection = await connectWithBaseProvider(asProvider(provider), CHALLENGE, () => {}, { requestEmail: true });
      const connects = provider.requests.filter(({ method }) => method === "wallet_connect");
      expect(connects).toHaveLength(2);
      expect(JSON.stringify(connects[1])).not.toContain("dataCallback");
      expect(connection.kind).toBe("proof");
      expect(connection.signInEmail).toMatchObject({ status: "refused", code });
    }

    const cancelled = new ProviderFixture();
    cancelled.emailConnectError = { code: 4001, message: "User rejected" };
    await expect(connectWithBaseProvider(asProvider(cancelled), CHALLENGE, () => {}, { requestEmail: true }))
      .rejects.toMatchObject({ reason: "cancelled" });
    expect(cancelled.requests.filter(({ method }) => method === "wallet_connect")).toHaveLength(1);
  });

  test("requests only the email with no calls, callback URL or id, synchronously from the caller", async () => {
    const provider = new EmailProviderFixture();
    const connection = await connectWithBaseProvider(asProvider(provider), CHALLENGE, () => {});
    const before = provider.requests.length;
    const pending = connection.requestEmail!();
    expect(provider.requests).toHaveLength(before + 1);
    expect(provider.requests.at(-1)).toEqual({
      method: "wallet_sendCalls",
      params: [{
        version: "2.0.0",
        chainId: "0x2105",
        from: ADDRESS,
        atomicRequired: true,
        calls: [],
        capabilities: { dataCallback: { requests: [{ type: "email", optional: false }] } },
      }],
    });
    expect(JSON.stringify(provider.requests.at(-1))).not.toContain("callbackURL");
    expect(await pending).toEqual({ status: "email", email: "person@example.com", bundleId: null });
  });

  test("returns a bundle id when present and separates wallet rejection from other failures", async () => {
    const provider = new EmailProviderFixture();
    const connection = await connectWithBaseProvider(asProvider(provider), CHALLENGE, () => {});
    provider.emailResult = { id: "0xbundle", capabilities: { dataCallback: { email: "a@b.co" } } };
    expect(await connection.requestEmail!()).toEqual({ status: "email", email: "a@b.co", bundleId: "0xbundle" });
    provider.emailResult = { id: "0xbundle", capabilities: {} };
    expect(await connection.requestEmail!()).toEqual({ status: "failed", code: null, message: "malformed" });
    for (const code of [4001, 5000]) {
      provider.emailError = { code, message: "User rejected" };
      expect(await connection.requestEmail!()).toEqual({ status: "declined" });
    }
    provider.emailError = { code: -32602, message: "Invalid params" };
    expect(await connection.requestEmail!()).toEqual({ status: "failed", code: -32602, message: "Invalid params" });
    provider.emailError = { code: 2147483648, message: "Out of range" };
    expect(await connection.requestEmail!()).toEqual({ status: "failed", code: null, message: "Out of range" });
    provider.emailError = new Error("boom");
    expect(await connection.requestEmail!()).toEqual({ status: "failed", code: null, message: "boom" });
  });
});
