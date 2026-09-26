import "./dom-test-harness";

import { describe, expect, test } from "bun:test";
import { MfaError } from "@coinbase/cdp-core";
import type { MutableRefObject } from "react";
import type { AccountWalletClient } from "./cdp-client";
import { BaseAccountConnectorError, type ConnectedBaseAccount } from "./base-account-connector";
import type { AuthenticatedTransport } from "./cdp-authenticated-transport";
import type { OwnerGenerationFence } from "./owner-generation-fence";
import type { VerifiedAccountSession } from "./session-client";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import type { TradeSigningRequest } from "@/shared/trading/contract";
import { TransferExecutionError } from "@/shared/transfers/types";

const { cleanup, render } = await import("@testing-library/react");
const { createElement, useEffect } = await import("react");
const { useMoneyActionExecution } = await import("./cdp-money-action-execution");

const id = "11111111-1111-4111-8111-111111111111";
const smartAccount = "0x1111111111111111111111111111111111111111" as const;
const evmAccount = "0x2222222222222222222222222222222222222222" as const;
const signature = `0x${"ab".repeat(65)}` as `0x${string}`;
const operationHash = `0x${"cd".repeat(32)}` as `0x${string}`;
const calls = [{ to: evmAccount, data: "0x1234" as const, value: "0" }];
const baseSigning = {
  signer: "base-account",
  typedData: {
    domain: { name: "Permit2", chainId: 8453, verifyingContract: "0x000000000022d473030f116ddee9f6b43ac78ba3" },
    types: {
      PermitTransferFrom: [
        { name: "permitted", type: "TokenPermissions" },
        { name: "spender", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
      TokenPermissions: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }],
    },
    primaryType: "PermitTransferFrom",
    message: { permitted: { token: evmAccount, amount: "10" }, spender: evmAccount, nonce: "2", deadline: "9999999999" },
  },
} as const satisfies TradeSigningRequest;
const cdpSigning = {
  signer: "cdp-embedded",
  evmAccount,
  typedData: {
    domain: { name: "Coinbase Smart Wallet", version: "1", chainId: 8453, verifyingContract: smartAccount },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" }, { name: "version", type: "string" },
        { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
      ],
      CoinbaseSmartWalletMessage: [{ name: "hash", type: "bytes32" }],
    },
    primaryType: "CoinbaseSmartWalletMessage",
    message: { hash: operationHash },
  },
} as const satisfies TradeSigningRequest;

function fixture(provider: VerifiedAccountSession["accountProvider"], signing: TradeSigningRequest | undefined, options?: {
  sign?: AccountWalletClient["signTypedData"];
  handle?: () => void;
  dispatch?: () => void;
  confirm?: (body: unknown, attempt: number) => void;
}) {
  let generation = 3;
  const events: Array<{ path: string; body: unknown }> = [];
  const signs: Array<{ typedData: unknown; options: unknown }> = [];
  const session: VerifiedAccountSession = {
    user: { subject: "owner" },
    smartAccount: { address: smartAccount, chainId: 8453 },
    accountProvider: provider,
  };
  const action: PreparedMoneyAction = {
    id,
    kind: "trade",
    title: "Trade",
    owner: { subject: "owner", address: smartAccount, chainId: 8453, accountProvider: provider },
    calls,
    amounts: [],
    warnings: [],
    expiresAt: "2099-01-01T00:00:00.000Z",
    createdAt: "2026-09-24T00:00:00.000Z",
    ...(signing ? { signing } : {}),
  };
  const ownerFence: OwnerGenerationFence = {
    capture: () => generation,
    assertCurrent: (value) => { if (value !== generation) throw new TransferExecutionError("stale-session"); },
    isCurrent: (value) => value === generation,
    advance: () => ++generation,
    updateAuthorizationBoundary: () => {},
    updateOwnerKey: () => false,
  };
  const transport = {
    fetchAccountResource: async (path: string, request?: { body?: unknown }) => {
      events.push({ path, body: request?.body });
      if (path === "/api/actions/prepare") return action;
      if (path === `/api/actions/${id}/confirm`) {
        options?.confirm?.(request?.body, events.filter((event) => event.path === path).length);
        return { calls };
      }
      if (path === `/api/actions/${id}/decline`) return { version: 1, action: { id } };
      if (path === `/api/actions/${id}/retry`) return { version: 1, action: { id } };
      if (path === `/api/actions/${id}/handle`) { options?.handle?.(); return {}; }
      throw new Error(`Unexpected account request ${path}`);
    },
  } as AuthenticatedTransport;
  const connection = {
    kind: "unsupported",
    address: smartAccount,
    signMessage: async () => signature,
    signTypedData: async () => signature,
    assertUnchanged: async () => {},
    sendCalls: async (_calls: unknown, _id: string, beforeDispatch?: () => Promise<void>) => {
      await beforeDispatch?.();
      options?.dispatch?.();
      return operationHash;
    },
    disconnect: async () => {},
  } as ConnectedBaseAccount;
  let execution!: ReturnType<typeof useMoneyActionExecution>;
  function Probe() {
    const actions = useMoneyActionExecution({
      session, status: "verified", verification: "server", ownerKey: "owner", ownerFence,
      sdkSendUserOperation: async () => {
        options?.dispatch?.();
        return { userOperationHash: operationHash };
      },
      sdkGetUserOperation: undefined,
      baseConnection: { current: provider === "base-account" ? connection : null } as MutableRefObject<ConnectedBaseAccount | null>,
      transport,
      signTypedData: async (typedData, signingOptions) => {
        signs.push({ typedData, options: signingOptions });
        return options?.sign ? options.sign(typedData, signingOptions) : signature;
      },
    });
    useEffect(() => { execution = actions; }, [actions]);
    return null;
  }
  render(createElement(Probe));
  return {
    action, events, signs,
    changeOwner: () => { generation += 1; },
    execution,
    async prepare() {
      await execution.prepareMoneyAction("trade", { amountBaseUnits: "10" });
      events.length = 0;
    },
    close() { execution.reset(); cleanup(); },
  };
}

describe("prepared trade signing", () => {
  test.each([
    ["base-account", baseSigning, undefined],
    ["cdp-embedded", cdpSigning, { evmAccount, idempotencyKey: id }],
  ] as const)("%s signs the prepared typed data and confirms with its raw signature", async (provider, signing, signingOptions) => {
    const run = fixture(provider, signing);
    try {
      await run.prepare();
      await expect(run.execution.executeMoneyAction(run.action)).resolves.toMatchObject({ id, status: "submitted" });
      expect(run.signs).toEqual([{ typedData: signing.typedData, options: signingOptions }]);
      expect(run.events).toEqual([
        { path: `/api/actions/${id}/confirm`, body: { signature } },
        { path: `/api/actions/${id}/handle`, body: { providerHandle: operationHash } },
      ]);
    } finally { run.close(); }
  });

  test.each([
    ["missing", "base-account", undefined],
    ["wrong signer", "base-account", cdpSigning],
    ["wrong Permit2 contract", "base-account", { ...baseSigning, typedData: { ...baseSigning.typedData, domain: { ...baseSigning.typedData.domain, verifyingContract: evmAccount } } }],
    ["smart account as EOA", "cdp-embedded", { ...cdpSigning, evmAccount: smartAccount }],
    ["malformed typed data", "cdp-embedded", { ...cdpSigning, typedData: { ...cdpSigning.typedData, message: { hash: "invalid" } } }],
  ] as const)("%s signing refuses to sign or confirm", async (_name, provider, signing) => {
    const run = fixture(provider, signing as TradeSigningRequest | undefined);
    try {
      await run.prepare();
      await expect(run.execution.executeMoneyAction(run.action)).rejects.toMatchObject({ reason: "invalid-request" });
      expect(run.signs).toEqual([]);
      expect(run.events).toEqual([]);
    } finally { run.close(); }
  });

  test.each([
    ["base-account", baseSigning, new BaseAccountConnectorError("cancelled")],
    ["cdp-embedded", cdpSigning, new MfaError("CANCELLED", "fixture cancellation")],
  ] as const)("%s wallet rejection leaves the action re-confirmable", async (provider, signing, rejection) => {
    let attempts = 0;
    const run = fixture(provider, signing, { sign: async () => {
      if (++attempts === 1) throw rejection;
      return signature;
    } });
    try {
      await run.prepare();
      await expect(run.execution.executeMoneyAction(run.action)).resolves.toEqual({ id, status: "rejected" });
      expect(run.events).toEqual([]);
      await expect(run.execution.executeMoneyAction(run.action)).resolves.toMatchObject({ status: "submitted" });
      expect(run.signs).toHaveLength(2);
      expect(run.events[0]).toEqual({ path: `/api/actions/${id}/confirm`, body: { signature } });
    } finally { run.close(); }
  });

  test("an owner change during signing aborts before confirming", async () => {
    const run = fixture("cdp-embedded", cdpSigning, { sign: async () => {
      run.changeOwner();
      return signature;
    } });
    try {
      await run.prepare();
      await expect(run.execution.executeMoneyAction(run.action)).rejects.toMatchObject({ reason: "stale-session" });
      expect(run.signs).toHaveLength(1);
      expect(run.events).toEqual([]);
    } finally { run.close(); }
  });

  test.each([
    ["wallet error", "base-account", baseSigning, async () => { throw new Error("wallet failed"); }],
    ["malformed signature", "cdp-embedded", cdpSigning, async () => "0xnot-a-signature" as `0x${string}`],
  ] as const)("%s before confirmation is not submitted", async (_case, provider, signing, sign) => {
    const run = fixture(provider, signing, { sign });
    try {
      await run.prepare();
      await expect(run.execution.executeMoneyAction(run.action)).rejects.toMatchObject({ name: "TransferExecutionError", reason: "not-submitted" });
      expect(run.signs).toHaveLength(1);
      expect(run.events).toEqual([]);
    } finally { run.close(); }
  });

  test("a handle-recording retry reuses the confirmed plan without re-signing", async () => {
    let posts = 0;
    const run = fixture("cdp-embedded", cdpSigning, { handle: () => {
      if (++posts === 1) throw new Error("response lost after remote commit");
    } });
    try {
      await run.prepare();
      await expect(run.execution.executeMoneyAction(run.action)).rejects.toMatchObject({ reason: "submission-unknown" });
      await expect(run.execution.executeMoneyAction(run.action)).resolves.toMatchObject({ status: "submitted" });
      expect(run.signs).toHaveLength(1);
      expect(run.events.map(({ path }) => path)).toEqual([
        `/api/actions/${id}/confirm`, `/api/actions/${id}/handle`, `/api/actions/${id}/handle`,
      ]);
    } finally { run.close(); }
  });

  test.each([
    ["base-account", baseSigning, new BaseAccountConnectorError("cancelled")],
    ["cdp-embedded", cdpSigning, new MfaError("CANCELLED", "fixture cancellation")],
  ] as const)("%s dispatch retry reuses its confirmed trade and signature", async (provider, signing, rejection) => {
    let attempts = 0;
    const run = fixture(provider, signing, { dispatch: () => { if (++attempts === 1) throw rejection; } });
    try {
      await run.prepare();
      await expect(run.execution.executeMoneyAction(run.action)).resolves.toEqual({ id, status: "rejected" });
      await expect(run.execution.executeMoneyAction(run.action)).resolves.toMatchObject({ status: "submitted" });
      expect(run.signs).toHaveLength(1);
      expect(attempts).toBe(2);
      expect(run.events).toEqual([
        { path: `/api/actions/${id}/confirm`, body: { signature } },
        { path: `/api/actions/${id}/decline`, body: { version: 1, attempt: 0 } },
        { path: `/api/actions/${id}/retry`, body: { version: 1, attempt: 1 } },
        { path: `/api/actions/${id}/handle`, body: { providerHandle: operationHash } },
      ]);
    } finally { run.close(); }
  });

  test.each(["base-account", "cdp-embedded"] as const)("%s recovers a committed confirm whose response was lost without re-signing", async (provider) => {
    const run = fixture(provider, provider === "base-account" ? baseSigning : cdpSigning, { confirm: (_body, attempt) => {
      if (attempt === 1) throw new TransferExecutionError("unavailable");
    } });
    try {
      await run.prepare();
      await expect(run.execution.executeMoneyAction(run.action)).rejects.toMatchObject({ reason: "unavailable" });
      await expect(run.execution.executeMoneyAction(run.action)).resolves.toMatchObject({ status: "submitted" });
      expect(run.signs).toHaveLength(1);
      expect(run.events).toEqual([
        { path: `/api/actions/${id}/confirm`, body: { signature } },
        { path: `/api/actions/${id}/confirm`, body: {} },
        { path: `/api/actions/${id}/handle`, body: { providerHandle: operationHash } },
      ]);
    } finally { run.close(); }
  });

  test("a confirm that never committed signs again after the replay requires a signature", async () => {
    const run = fixture("cdp-embedded", cdpSigning, { confirm: (_body, attempt) => {
      if (attempt === 1) throw new TransferExecutionError("unavailable");
      if (attempt === 2) throw Object.assign(new TransferExecutionError("unavailable"), { status: 400 });
    } });
    try {
      await run.prepare();
      await expect(run.execution.executeMoneyAction(run.action)).rejects.toMatchObject({ reason: "unavailable" });
      await expect(run.execution.executeMoneyAction(run.action)).resolves.toMatchObject({ status: "submitted" });
      expect(run.signs).toHaveLength(2);
      expect(run.events.map(({ body }) => body)).toEqual([{ signature }, {}, { signature }, { providerHandle: operationHash }]);
    } finally { run.close(); }
  });

  test("a refused replay does not sign again or dispatch", async () => {
    const run = fixture("cdp-embedded", cdpSigning, { confirm: (_body, attempt) => {
      if (attempt === 1) throw new TransferExecutionError("unavailable");
      if (attempt === 2) throw Object.assign(new TransferExecutionError("unavailable"), { status: 404 });
    } });
    try {
      await run.prepare();
      await expect(run.execution.executeMoneyAction(run.action)).rejects.toMatchObject({ reason: "unavailable" });
      await expect(run.execution.executeMoneyAction(run.action)).rejects.toMatchObject({ reason: "unavailable" });
      expect(run.signs).toHaveLength(1);
      expect(run.events.map(({ body }) => body)).toEqual([{ signature }, {}]);
    } finally { run.close(); }
  });

  test("non-trade actions still confirm with an empty body", async () => {
    const run = fixture("base-account", baseSigning);
    try {
      await run.prepare();
      await expect(run.execution.executeMoneyAction({ ...run.action, kind: "send" })).resolves.toMatchObject({ status: "submitted" });
      expect(run.signs).toEqual([]);
      expect(run.events[0]).toEqual({ path: `/api/actions/${id}/confirm`, body: {} });
    } finally { run.close(); }
  });
});
