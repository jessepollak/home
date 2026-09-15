"use client";

import type { ProviderInterface } from "@base-org/account";
import { createWalletClient, custom } from "viem";
import { base } from "viem/chains";
import { connect } from "viem/experimental/erc7846";
import type { NativeBaseChallenge } from "@/shared/account/contracts/base-nonce";
import { BASE_CHAIN_ID } from "@/shared/account/session-types";

const BASE_CHAIN_HEX = "0x2105";
const evmAddressPattern = /^0x[0-9a-fA-F]{40}$/;
const hexPattern = /^0x(?:[0-9a-fA-F]{2})+$/;
const transactionHashPattern = /^0x[0-9a-fA-F]{64}$/;

export type BaseAccountInvalidation =
  | "account-changed"
  | "chain-changed"
  | "disconnected";

export class BaseAccountConnectorError extends Error {
  readonly reason:
    | BaseAccountInvalidation
    | "cancelled"
    | "missing-connection"
    | "invalid-provider-response";

  constructor(
    reason: BaseAccountConnectorError["reason"],
    cause?: unknown,
  ) {
    super(reason, { cause });
    this.name = "BaseAccountConnectorError";
    this.reason = reason;
  }
}

export type BaseAccountTransaction = {
  to: `0x${string}`;
  value: bigint;
  data: `0x${string}`;
};

export type BaseAccountCallStatus =
  | { status: "pending" }
  | { status: "failed" }
  | { status: "complete"; transactionHash: `0x${string}` };

type ConnectedBaseAccountCommon = {
  address: `0x${string}`;
  assertUnchanged: () => Promise<void>;
  signMessage: (message: string) => Promise<`0x${string}`>;
  signTypedData: (typedData: unknown) => Promise<`0x${string}`>;
  sendCalls?: (
    calls: BaseAccountTransaction[],
    requestId: string,
    beforeDispatch?: () => Promise<void>,
    batchGasLimit?: string,
  ) => Promise<string>;
  getCallsStatus?: (submissionId: string) => Promise<BaseAccountCallStatus>;
  release?: () => void;
  disconnect: () => Promise<void>;
};

export type ConnectedBaseAccount = ConnectedBaseAccountCommon & (
  | { kind: "proof"; message: string; signature: `0x${string}` }
  | { kind: "unsupported" }
);

export type BaseAccountConnector = (
  challenge: NativeBaseChallenge,
  onInvalidated: (reason: BaseAccountInvalidation) => void,
) => Promise<ConnectedBaseAccount>;

export type BaseAccountRestorer = (
  onInvalidated: (reason: BaseAccountInvalidation) => void,
) => Promise<ConnectedBaseAccount>;

type BaseAccountProvider = Pick<
  ProviderInterface,
  "request" | "on" | "removeListener" | "disconnect"
>;

function isValidBatchGasLimit(value: string): boolean {
  if (!/^[1-9]\d*$/.test(value)) return false;
  try {
    return BigInt(value) <= BigInt(2_000_000);
  } catch {
    return false;
  }
}

function providerErrorCode(error: unknown): number | null {
  if (
    !error || typeof error !== "object" ||
    !("code" in error) || typeof error.code !== "number" || !Number.isSafeInteger(error.code) ||
    !("message" in error) || typeof error.message !== "string" || !error.message
  ) return null;
  return error.code;
}

function normalizeAddress(value: unknown): `0x${string}` | null {
  return typeof value === "string" && evmAddressPattern.test(value)
    ? (value.toLowerCase() as `0x${string}`)
    : null;
}

function firstAddress(value: unknown): `0x${string}` | null {
  return Array.isArray(value) ? normalizeAddress(value[0]) : null;
}

function chainIdFromProvider(value: unknown): number | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    return null;
  }

  const parsed = Number.parseInt(value.slice(2), 16);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function utf8MessageToHex(message: string): `0x${string}` {
  const bytes = new TextEncoder().encode(message);
  return `0x${Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

async function openBaseProvider(
  provider: BaseAccountProvider,
  onInvalidated: (reason: BaseAccountInvalidation) => void,
  interactive: boolean,
  challenge?: NativeBaseChallenge,
): Promise<ConnectedBaseAccount> {
  let invalidation: BaseAccountInvalidation | null = null;
  let connectedAddress: `0x${string}` | null = null;

  const invalidate = (reason: BaseAccountInvalidation) => {
    if (invalidation) {
      return;
    }
    invalidation = reason;
    onInvalidated(reason);
  };
  const onAccountsChanged = (accounts: string[]) => {
    if (!connectedAddress || !Array.isArray(accounts)) {
      return;
    }
    const nextAddress = firstAddress(accounts);
    if (accounts.length > 0 && !nextAddress) {
      return;
    }
    if (nextAddress !== connectedAddress) {
      invalidate("account-changed");
    }
  };
  const onChainChanged = (chainId: string) => {
    const nextChainId = chainIdFromProvider(chainId);
    if (nextChainId !== null && nextChainId !== BASE_CHAIN_ID) {
      invalidate("chain-changed");
    }
  };
  const onDisconnect = () => invalidate("disconnected");

  provider.on("accountsChanged", onAccountsChanged);
  provider.on("chainChanged", onChainChanged);
  provider.on("disconnect", onDisconnect);

  const removeListeners = () => {
    provider.removeListener("accountsChanged", onAccountsChanged);
    provider.removeListener("chainChanged", onChainChanged);
    provider.removeListener("disconnect", onDisconnect);
  };

  let resultKind: "proof" | "unsupported" = "unsupported";
  let proof: { message: string; signature: `0x${string}` } | null = null;
  let walletConnected = false;
  try {
    let accounts: unknown;
    if (interactive) {
      if (!challenge) throw new BaseAccountConnectorError("invalid-provider-response");
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: BASE_CHAIN_HEX }],
      });
      try {
        const response = await connect(
          createWalletClient({
            chain: base,
            transport: custom({
              request: async (args) => {
                try {
                  const response = await provider.request(args);
                  if (args.method === "wallet_connect") walletConnected = true;
                  return response;
                } catch (error) {
                  if (providerErrorCode(error) === null) {
                    throw new BaseAccountConnectorError("invalid-provider-response", error);
                  }
                  throw error;
                }
              },
            }, { retryCount: 0 }),
          }),
          {
            capabilities: {
              unstable_signInWithEthereum: {
                nonce: challenge.nonce,
                chainId: challenge.chainId,
                domain: challenge.domain,
                uri: challenge.uri,
                version: challenge.version,
                statement: challenge.statement,
                issuedAt: new Date(challenge.issuedAt),
                expirationTime: new Date(challenge.expirationTime),
              },
            },
          },
        );
        accounts = response.accounts;
        if (!Array.isArray(accounts) || accounts.length !== 1) {
          throw new BaseAccountConnectorError("invalid-provider-response");
        }
        const account = accounts[0];
        connectedAddress = normalizeAddress(account?.address);
        if (!connectedAddress) throw new BaseAccountConnectorError("invalid-provider-response");
        const signIn = account.capabilities?.unstable_signInWithEthereum;
        const capabilityCode = providerErrorCode(signIn);
        if (capabilityCode !== null) {
          if ("signature" in signIn) {
            throw new BaseAccountConnectorError("invalid-provider-response", signIn);
          }
          if ([4200, -32601, -32004].includes(capabilityCode)) {
            resultKind = "unsupported";
          } else if (capabilityCode === 4001 || capabilityCode === 5000) {
            throw new BaseAccountConnectorError("cancelled", signIn);
          } else {
            throw new BaseAccountConnectorError("invalid-provider-response", signIn);
          }
        } else if (
          signIn && typeof signIn === "object" &&
          "message" in signIn && typeof signIn.message === "string" && signIn.message.length > 0 && signIn.message.length <= 16_384 &&
          "signature" in signIn && typeof signIn.signature === "string" && hexPattern.test(signIn.signature)
        ) {
          resultKind = "proof";
          proof = { message: signIn.message, signature: signIn.signature.toLowerCase() as `0x${string}` };
        } else {
          throw new BaseAccountConnectorError("invalid-provider-response");
        }
      } catch (error) {
        if (error instanceof BaseAccountConnectorError) throw error;
        const code = providerErrorCode(error);
        if (code === 4001 || code === 5000) {
          throw new BaseAccountConnectorError("cancelled", error);
        }
        if (![4200, -32601, -32004].includes(code ?? Number.NaN)) {
          throw new BaseAccountConnectorError("invalid-provider-response", error);
        }
        accounts = await provider.request({ method: "eth_requestAccounts" });
        walletConnected = true;
        if (!Array.isArray(accounts) || accounts.length !== 1) {
          throw new BaseAccountConnectorError("invalid-provider-response");
        }
        connectedAddress = firstAddress(accounts);
      }
    } else {
      accounts = await provider.request({ method: "eth_accounts" });
      if (Array.isArray(accounts) && accounts.length === 0) {
        throw new BaseAccountConnectorError("missing-connection");
      }
      if (!Array.isArray(accounts) || accounts.length !== 1) {
        throw new BaseAccountConnectorError("invalid-provider-response");
      }
      connectedAddress = firstAddress(accounts);
    }
    if (!connectedAddress) throw new BaseAccountConnectorError("invalid-provider-response");
    const chainId = chainIdFromProvider(
      await provider.request({ method: "eth_chainId" }),
    );
    if (chainId === null) throw new BaseAccountConnectorError("invalid-provider-response");
    if (chainId !== BASE_CHAIN_ID) throw new BaseAccountConnectorError("chain-changed");
    if (invalidation) throw new BaseAccountConnectorError(invalidation);
  } catch (error) {
    removeListeners();
    if (walletConnected) {
      try { await provider.disconnect(); } catch { /* best-effort wallet cleanup */ }
    }
    if (error instanceof BaseAccountConnectorError) throw error;
    const code = providerErrorCode(error);
    if (code === 4001 || code === 5000) throw new BaseAccountConnectorError("cancelled", error);
    throw new BaseAccountConnectorError("invalid-provider-response", error);
  }

  const assertUnchanged = async () => {
    if (invalidation) {
      throw new BaseAccountConnectorError(invalidation);
    }

    const [accounts, chainIdValue] = await Promise.all([
      provider.request({ method: "eth_accounts" }),
      provider.request({ method: "eth_chainId" }),
    ]);
    const accountAddress = firstAddress(accounts);
    if (
      !Array.isArray(accounts) ||
      (accounts.length > 0 && !accountAddress)
    ) {
      throw new BaseAccountConnectorError("invalid-provider-response");
    }
    if (accountAddress !== connectedAddress) {
      invalidate("account-changed");
      throw new BaseAccountConnectorError("account-changed");
    }
    const chainId = chainIdFromProvider(chainIdValue);
    if (chainId === null) {
      throw new BaseAccountConnectorError("invalid-provider-response");
    }
    if (chainId !== BASE_CHAIN_ID) {
      invalidate("chain-changed");
      throw new BaseAccountConnectorError("chain-changed");
    }
    if (invalidation) {
      throw new BaseAccountConnectorError(invalidation);
    }
  };

  return {
    ...(resultKind === "proof" && proof
      ? { kind: "proof" as const, ...proof }
      : { kind: "unsupported" as const }),
    address: connectedAddress,
    assertUnchanged,
    async signMessage(message) {
      await assertUnchanged();
      let signature: unknown;
      try {
        signature = await provider.request({
          method: "personal_sign",
          params: [utf8MessageToHex(message), connectedAddress],
        });
      } catch (error) {
        const code = providerErrorCode(error);
        if (code === 4001 || code === 5000) {
          throw new BaseAccountConnectorError("cancelled", error);
        }
        throw new BaseAccountConnectorError("invalid-provider-response", error);
      }
      await assertUnchanged();
      if (typeof signature !== "string" || !hexPattern.test(signature)) {
        throw new BaseAccountConnectorError("invalid-provider-response");
      }
      return signature as `0x${string}`;
    },
    async signTypedData(typedData) {
      await assertUnchanged();
      let signature: unknown;
      try {
        signature = await provider.request({
          method: "eth_signTypedData_v4",
          params: [connectedAddress, JSON.stringify(typedData)],
        });
      } catch (error) {
        if (providerErrorCode(error) === 4001) {
          throw new BaseAccountConnectorError("cancelled", error);
        }
        throw new BaseAccountConnectorError("invalid-provider-response", error);
      }
      await assertUnchanged();
      if (typeof signature !== "string" || !hexPattern.test(signature) || signature.length < 132) {
        throw new BaseAccountConnectorError("invalid-provider-response");
      }
      return signature.toLowerCase() as `0x${string}`;
    },
    async sendCalls(calls, requestId, beforeDispatch, batchGasLimit) {
      await assertUnchanged();
      if (
        calls.length < 1 || calls.length > 8 || !requestId ||
        (batchGasLimit !== undefined && !isValidBatchGasLimit(batchGasLimit))
      ) {
        throw new BaseAccountConnectorError("invalid-provider-response");
      }
      await beforeDispatch?.();
      let result: unknown;
      try {
        result = await provider.request({
          method: "wallet_sendCalls",
          params: [{
            version: "2.0.0",
            chainId: BASE_CHAIN_HEX,
            from: connectedAddress,
            atomicRequired: true,
            id: requestId,
            calls: calls.map((call, index) => ({
              to: call.to,
              value: `0x${call.value.toString(16)}`,
              data: call.data,
              ...(batchGasLimit !== undefined && index === calls.length - 1
                ? { capabilities: { gasLimitOverride: { value: `0x${BigInt(batchGasLimit).toString(16)}` } } }
                : {}),
            })),
          }],
        });
      } catch (error) {
        if (providerErrorCode(error) === 4001) {
          throw new BaseAccountConnectorError("cancelled", error);
        }
        throw new BaseAccountConnectorError("invalid-provider-response", error);
      }
      const id = typeof result === "string"
        ? result
        : result && typeof result === "object" && "id" in result && typeof result.id === "string"
          ? result.id
          : null;
      if (!id || id.length > 512) {
        throw new BaseAccountConnectorError("invalid-provider-response");
      }
      // The provider handle is durable evidence that the request returned. Parse and
      // return it before any unrelated account-state read can erase that evidence.
      return id;
    },
    async getCallsStatus(submissionId) {
      if (!submissionId || submissionId.length > 512) {
        throw new BaseAccountConnectorError("invalid-provider-response");
      }
      let result: unknown;
      try {
        result = await provider.request({ method: "wallet_getCallsStatus", params: [submissionId] });
      } catch (error) {
        throw new BaseAccountConnectorError("invalid-provider-response", error);
      }
      if (
        !result ||
        typeof result !== "object" ||
        !("id" in result) ||
        result.id !== submissionId ||
        !("version" in result) ||
        result.version !== "2.0.0" ||
        !("chainId" in result) ||
        chainIdFromProvider(result.chainId) !== BASE_CHAIN_ID ||
        !("atomic" in result) ||
        result.atomic !== true ||
        !("status" in result) ||
        typeof result.status !== "number" ||
        !Number.isSafeInteger(result.status)
      ) {
        throw new BaseAccountConnectorError("invalid-provider-response");
      }
      if (result.status >= 100 && result.status < 200) return { status: "pending" };
      if (result.status >= 300 && result.status < 700) return { status: "failed" };
      if (result.status < 200 || result.status >= 300) {
        throw new BaseAccountConnectorError("invalid-provider-response");
      }
      if (!("receipts" in result) || !Array.isArray(result.receipts) || result.receipts.length < 1) {
        throw new BaseAccountConnectorError("invalid-provider-response");
      }
      const hashes = new Set(result.receipts.map((receipt) =>
        receipt && typeof receipt === "object" && "transactionHash" in receipt && typeof receipt.transactionHash === "string"
          ? receipt.transactionHash.toLowerCase()
          : "",
      ));
      if (hashes.size !== 1) throw new BaseAccountConnectorError("invalid-provider-response");
      const transactionHash = [...hashes][0];
      if (!transactionHashPattern.test(transactionHash)) {
        throw new BaseAccountConnectorError("invalid-provider-response");
      }
      return { status: "complete", transactionHash: transactionHash as `0x${string}` };
    },
    release: removeListeners,
    async disconnect() {
      removeListeners();
      try {
        await provider.disconnect();
      } catch {
        // Local connector cleanup must not expose provider internals.
      }
    },
  };
}

export function connectWithBaseProvider(
  provider: BaseAccountProvider,
  challenge: NativeBaseChallenge,
  onInvalidated: (reason: BaseAccountInvalidation) => void,
): Promise<ConnectedBaseAccount> {
  return openBaseProvider(provider, onInvalidated, true, challenge);
}

export function restoreWithBaseProvider(
  provider: BaseAccountProvider,
  onInvalidated: (reason: BaseAccountInvalidation) => void,
): Promise<ConnectedBaseAccount> {
  return openBaseProvider(provider, onInvalidated, false);
}

async function createBaseProvider(): Promise<BaseAccountProvider> {
  const { createBaseAccountSDK } = await import("@base-org/account");
  return createBaseAccountSDK({
    appName: "Home",
    appChainIds: [BASE_CHAIN_ID],
    preference: { telemetry: false },
    subAccounts: {
      creation: "manual",
      defaultAccount: "universal",
      funding: "manual",
    },
  }).getProvider();
}

export const connectBaseAccount: BaseAccountConnector = async (
  challenge,
  onInvalidated,
) => connectWithBaseProvider(await createBaseProvider(), challenge, onInvalidated);

export const restoreBaseAccount: BaseAccountRestorer = async (
  onInvalidated,
) => restoreWithBaseProvider(await createBaseProvider(), onInvalidated);
