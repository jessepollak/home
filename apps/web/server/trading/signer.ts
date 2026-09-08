import {
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  type Hex as ViemHex,
} from "viem";
import type { VerifiedAccountSession } from "@/features/account/session-types";
import type { AccessTokenValidator } from "@/server/cdp/session";
import { resolveBaseRpcUrl, PORTFOLIO_RPC_TIMEOUT_MS } from "@/server/portfolio/rpc";
import { nonceBitmapPosition, PERMIT2_ADDRESS } from "./permit2";
import { TradePreparationError } from "./prepare";
import type {
  Address,
  Hex,
  Permit2StateReader,
  SmartAccountSignatureVerifier,
  TradeSignerResolver,
} from "./types";

const FACTORY_ADDRESS = "0xba5ed110efdba3d005bfc882d75358acbbb85842" as const;
const ERC1271_MAGIC = "0x1626ba7e";
const compactJwtPattern = /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const quantityPattern = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const hexPattern = /^0x(?:[0-9a-fA-F]{2})*$/;

const smartWalletAbi = [
  { type: "function", name: "isOwnerAddress", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "ownerAtIndex", stateMutability: "view", inputs: [{ name: "index", type: "uint256" }], outputs: [{ type: "bytes" }] },
  { type: "function", name: "isValidSignature", stateMutability: "view", inputs: [{ name: "hash", type: "bytes32" }, { name: "signature", type: "bytes" }], outputs: [{ type: "bytes4" }] },
] as const;
const factoryAbi = [{ type: "function", name: "getAddress", stateMutability: "view", inputs: [{ name: "owners", type: "bytes[]" }, { name: "nonce", type: "uint256" }], outputs: [{ type: "address" }] }] as const;
const permit2Abi = [{ type: "function", name: "nonceBitmap", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "wordPos", type: "uint256" }], outputs: [{ type: "uint256" }] }] as const;

export function createTradeSignerResolver({
  getValidator,
  fetchImpl = fetch,
  rpcUrl = resolveBaseRpcUrl(),
  timeoutMs = PORTFOLIO_RPC_TIMEOUT_MS,
}: {
  getValidator: () => Promise<AccessTokenValidator>;
  fetchImpl?: typeof fetch;
  rpcUrl?: string;
  timeoutMs?: number;
}): TradeSignerResolver {
  const rpc = createRpc(fetchImpl, rpcUrl, timeoutMs);
  return async (request, session, signal) => {
    if (!session.smartAccount) unsupported();
    if (session.accountProvider === "base-account") {
      return resolveBaseAccountSigner(rpc, session.smartAccount.address, signal);
    }
    if (session.accountProvider !== "cdp-embedded") unsupported();
    const token = readBearerToken(request);
    if (!token) unsupported();
    const validator = await getValidator();
    const identity = parseFreshIdentity(await validator.validateAccessToken(token), session);
    if (await rpc.quantity("eth_chainId", [], signal) !== BigInt(8453)) unavailable();
    const code = await rpc.hex("eth_getCode", [identity.smartAccount, "latest"], signal);
    if (code !== "0x") {
      return {
        smartAccount: identity.smartAccount,
        signerAddress: await resolveDeployedOwner(rpc, identity, signal),
        ownerIndex: 0,
        deployed: true,
      };
    }
    if (identity.ownerAddresses.length !== 1 || identity.controlledOwners.length !== 1) unsupported();
    const candidate = identity.controlledOwners[0];
    const encodedOwner = encodeAbiParameters([{ type: "address" }], [candidate]);
    const result = await rpc.call(FACTORY_ADDRESS, encodeFunctionData({
      abi: factoryAbi,
      functionName: "getAddress",
      args: [[encodedOwner], BigInt(0)],
    }), signal);
    const [derived] = decodeAbiParameters([{ type: "address" }], result);
    if (derived.toLowerCase() !== identity.smartAccount) unsupported();
    return { smartAccount: identity.smartAccount, signerAddress: candidate, ownerIndex: 0, deployed: false };
  };
}

export function createPermit2StateReader({
  fetchImpl = fetch,
  rpcUrl = resolveBaseRpcUrl(),
  timeoutMs = PORTFOLIO_RPC_TIMEOUT_MS,
}: { fetchImpl?: typeof fetch; rpcUrl?: string; timeoutMs?: number } = {}): Permit2StateReader {
  const rpc = createRpc(fetchImpl, rpcUrl, timeoutMs);
  return async (owner, nonce, signal) => {
    if (await rpc.quantity("eth_chainId", [], signal) !== BigInt(8453)) unavailable();
    const blockNumber = await rpc.quantity("eth_blockNumber", [], signal);
    const { wordPos, mask } = nonceBitmapPosition(nonce);
    const result = await rpc.call(PERMIT2_ADDRESS, encodeFunctionData({
      abi: permit2Abi,
      functionName: "nonceBitmap",
      args: [owner, wordPos],
    }), signal, blockNumber);
    const [bitmap] = decodeAbiParameters([{ type: "uint256" }], result);
    return { blockNumber, used: (bitmap & mask) !== BigInt(0) };
  };
}

export function createSmartAccountSignatureVerifier({
  fetchImpl = fetch,
  rpcUrl = resolveBaseRpcUrl(),
  timeoutMs = PORTFOLIO_RPC_TIMEOUT_MS,
}: { fetchImpl?: typeof fetch; rpcUrl?: string; timeoutMs?: number } = {}): SmartAccountSignatureVerifier {
  const rpc = createRpc(fetchImpl, rpcUrl, timeoutMs);
  return async ({ smartAccount, permitHash, wrapper, signal }) => {
    const result = await rpc.call(smartAccount, encodeFunctionData({
      abi: smartWalletAbi,
      functionName: "isValidSignature",
      args: [permitHash, wrapper],
    }), signal);
    const [magic] = decodeAbiParameters([{ type: "bytes4" }], result);
    return magic.toLowerCase() === ERC1271_MAGIC;
  };
}

async function resolveBaseAccountSigner(
  rpc: ReturnType<typeof createRpc>,
  smartAccount: Address,
  signal?: AbortSignal,
): Promise<{ smartAccount: Address; signerAddress: Address; ownerIndex: 0; deployed: true }> {
  if (await rpc.quantity("eth_chainId", [], signal) !== BigInt(8453)) unavailable();
  const code = await rpc.hex("eth_getCode", [smartAccount, "latest"], signal);
  if (code === "0x") unsupported();
  const result = await rpc.call(smartAccount, encodeFunctionData({
    abi: smartWalletAbi,
    functionName: "ownerAtIndex",
    args: [BigInt(0)],
  }), signal);
  const [ownerBytes] = decodeAbiParameters([{ type: "bytes" }], result);
  let signerAddress = smartAccount;
  if (ownerBytes.length === 66) {
    try {
      const [decoded] = decodeAbiParameters([{ type: "address" }], ownerBytes);
      const candidate = decoded.toLowerCase() as Address;
      const ownership = await rpc.call(smartAccount, encodeFunctionData({
        abi: smartWalletAbi,
        functionName: "isOwnerAddress",
        args: [candidate],
      }), signal);
      const [isOwner] = decodeAbiParameters([{ type: "bool" }], ownership);
      if (!isOwner) unsupported();
      signerAddress = candidate;
    } catch (error) {
      if (error instanceof TradePreparationError) throw error;
    }
  }
  return { smartAccount, signerAddress, ownerIndex: 0, deployed: true };
}

async function resolveDeployedOwner(
  rpc: ReturnType<typeof createRpc>,
  identity: FreshTradeIdentity,
  signal?: AbortSignal,
): Promise<Address> {
  const result = await rpc.call(identity.smartAccount, encodeFunctionData({
    abi: smartWalletAbi,
    functionName: "ownerAtIndex",
    args: [BigInt(0)],
  }), signal);
  const [ownerBytes] = decodeAbiParameters([{ type: "bytes" }], result);
  if (ownerBytes.length !== 66) unsupported();
  let candidate: Address;
  try {
    const [decoded] = decodeAbiParameters([{ type: "address" }], ownerBytes);
    candidate = decoded.toLowerCase() as Address;
  } catch {
    unsupported();
  }
  if (!identity.controlledOwners.includes(candidate)) unsupported();
  const ownership = await rpc.call(identity.smartAccount, encodeFunctionData({
    abi: smartWalletAbi,
    functionName: "isOwnerAddress",
    args: [candidate],
  }), signal);
  const [isOwner] = decodeAbiParameters([{ type: "bool" }], ownership);
  if (!isOwner) unsupported();
  return candidate;
}

type FreshTradeIdentity = { smartAccount: Address; ownerAddresses: Address[]; controlledOwners: Address[] };

function parseFreshIdentity(value: unknown, session: VerifiedAccountSession): FreshTradeIdentity {
  if (!isRecord(value) || !session.smartAccount || value.userId !== session.user.subject) unsupported();
  if (!Array.isArray(value.evmAccountObjects) || !Array.isArray(value.evmSmartAccountObjects)) unsupported();
  const controlled = new Set<Address>();
  for (const account of value.evmAccountObjects) {
    if (!isRecord(account)) unsupported();
    controlled.add(normalizeAddress(account.address));
  }
  const matches = value.evmSmartAccountObjects.filter((account) =>
    isRecord(account) && normalizeAddress(account.address) === session.smartAccount!.address,
  );
  if (matches.length !== 1) unsupported();
  const match = matches[0];
  if (!Array.isArray(match.ownerAddresses) || match.ownerAddresses.length < 1) unsupported();
  const ownerAddresses: Address[] = match.ownerAddresses.map((address: unknown) => normalizeAddress(address));
  if (new Set(ownerAddresses).size !== ownerAddresses.length) unsupported();
  const controlledOwners = ownerAddresses.filter((address) => controlled.has(address));
  if (controlledOwners.length < 1) unsupported();
  return { smartAccount: session.smartAccount.address, ownerAddresses, controlledOwners };
}

function createRpc(fetchImpl: typeof fetch, rpcUrl: string, timeoutMs: number) {
  async function request(method: string, params: unknown[], signal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, timeoutMs);
    try {
      const response = await fetchImpl(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) unavailable();
      const payload: unknown = await response.json();
      if (!isRecord(payload) || !("result" in payload) || "error" in payload) unavailable();
      return payload.result;
    } catch (error) {
      if (error instanceof TradePreparationError) throw error;
      unavailable(error);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
  return {
    async quantity(method: string, params: unknown[], signal?: AbortSignal) {
      const value = await request(method, params, signal);
      if (typeof value !== "string" || !quantityPattern.test(value)) unavailable();
      return BigInt(value);
    },
    async hex(method: string, params: unknown[], signal?: AbortSignal) {
      const value = await request(method, params, signal);
      if (typeof value !== "string" || !hexPattern.test(value)) unavailable();
      return value.toLowerCase() as Hex;
    },
    async call(to: Address, data: Hex, signal?: AbortSignal, blockNumber?: bigint): Promise<ViemHex> {
      return this.hex("eth_call", [{ to, data }, blockNumber === undefined ? "latest" : `0x${blockNumber.toString(16)}`], signal) as Promise<ViemHex>;
    },
  };
}

function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  const token = authorization ? /^Bearer[\t ]+([^\s,]+)$/i.exec(authorization)?.[1] : null;
  return token && token.length <= 8192 && compactJwtPattern.test(token) ? token : null;
}

function normalizeAddress(value: unknown): Address {
  if (typeof value !== "string" || !addressPattern.test(value)) unsupported();
  return value.toLowerCase() as Address;
}

function unsupported(): never { throw new TradePreparationError("signer-unsupported"); }
function unavailable(cause?: unknown): never { throw new TradePreparationError("provider-unavailable", cause); }
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
