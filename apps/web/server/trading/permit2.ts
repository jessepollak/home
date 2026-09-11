import {
  encodeAbiParameters,
  hashTypedData,
  recoverTypedDataAddress,
  type Hex as ViemHex,
} from "viem";
import type {
  Address,
  CoinbaseSmartWalletTypedData,
  Hex,
  Permit2TypedData,
} from "@/shared/trading/server-types";
import { TradePreparationError } from "./prepare";

export const BASE_CHAIN_ID = 8453 as const;
export const PERMIT2_ADDRESS =
  "0x000000000022d473030f116ddee9f6b43ac78ba3" as const;
export const MAX_PERMIT_LIFETIME_SECONDS = BigInt(30 * 60);
const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const signaturePattern = /^0x[0-9a-fA-F]{130}$/;
const SECP256K1_N = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");

const EIP712_DOMAIN_FIELDS = [
  { name: "name", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
] as const;
const PERMIT_FIELDS = [
  { name: "permitted", type: "TokenPermissions" },
  { name: "spender", type: "address" },
  { name: "nonce", type: "uint256" },
  { name: "deadline", type: "uint256" },
] as const;
const TOKEN_FIELDS = [
  { name: "token", type: "address" },
  { name: "amount", type: "uint256" },
] as const;

export function validatePermit2(input: {
  eip712: unknown;
  providerHash: string;
  token: Address;
  amount: bigint;
  now: Date;
}): {
  typedData: Permit2TypedData;
  permitHash: Hex;
  deadline: bigint;
  nonce: bigint;
  spender: Address;
} {
  if (!isRecord(input.eip712)) reject();
  const rootKeys = Object.keys(input.eip712).sort();
  if (rootKeys.join(",") !== "domain,message,primaryType,types") reject();
  if (input.eip712.primaryType !== "PermitTransferFrom") reject();

  const domain = input.eip712.domain;
  if (!isRecord(domain) || Object.keys(domain).sort().join(",") !== "chainId,name,verifyingContract") {
    reject();
  }
  if (
    domain.name !== "Permit2" ||
    parseUint(domain.chainId) !== BigInt(BASE_CHAIN_ID) ||
    normalizeAddress(domain.verifyingContract) !== PERMIT2_ADDRESS
  ) reject();

  const types = input.eip712.types;
  if (!isRecord(types)) reject();
  const typeKeys = Object.keys(types).sort().join(",");
  if (
    typeKeys !== "PermitTransferFrom,TokenPermissions" &&
    typeKeys !== "EIP712Domain,PermitTransferFrom,TokenPermissions"
  ) reject();
  assertFields(types.PermitTransferFrom, PERMIT_FIELDS);
  assertFields(types.TokenPermissions, TOKEN_FIELDS);
  if ("EIP712Domain" in types) assertFields(types.EIP712Domain, EIP712_DOMAIN_FIELDS);

  const message = input.eip712.message;
  if (!isRecord(message) || Object.keys(message).sort().join(",") !== "deadline,nonce,permitted,spender") {
    reject();
  }
  if (!isRecord(message.permitted) || Object.keys(message.permitted).sort().join(",") !== "amount,token") {
    reject();
  }
  const token = normalizeAddress(message.permitted.token);
  const amount = parseUint(message.permitted.amount);
  const spender = normalizeAddress(message.spender);
  const nonce = parseUint(message.nonce);
  const deadline = parseUint(message.deadline);
  const nowSeconds = BigInt(Math.floor(input.now.getTime() / 1000));
  if (
    token !== input.token ||
    amount !== input.amount ||
    amount <= BigInt(0) ||
    spender === ZERO_ADDRESS ||
    deadline <= nowSeconds ||
    deadline - nowSeconds > MAX_PERMIT_LIFETIME_SECONDS
  ) reject();

  const typedData: Permit2TypedData = {
    domain: {
      name: "Permit2",
      chainId: BASE_CHAIN_ID,
      verifyingContract: PERMIT2_ADDRESS,
    },
    types: {
      ...(typeKeys.startsWith("EIP712Domain")
        ? { EIP712Domain: EIP712_DOMAIN_FIELDS }
        : {}),
      PermitTransferFrom: PERMIT_FIELDS,
      TokenPermissions: TOKEN_FIELDS,
    },
    primaryType: "PermitTransferFrom",
    message: {
      permitted: { token, amount: amount.toString() },
      spender,
      nonce: nonce.toString(),
      deadline: deadline.toString(),
    },
  };
  const permitHash = hashTypedData(typedData as Parameters<typeof hashTypedData>[0]).toLowerCase() as Hex;
  if (!hashPattern.test(input.providerHash) || permitHash !== input.providerHash.toLowerCase()) reject();
  return { typedData, permitHash, deadline, nonce, spender };
}

export function createCoinbaseSmartWalletTypedData(
  smartAccount: Address,
  permitHash: Hex,
): CoinbaseSmartWalletTypedData {
  return {
    domain: {
      name: "Coinbase Smart Wallet",
      version: "1",
      chainId: BASE_CHAIN_ID,
      verifyingContract: smartAccount,
    },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      CoinbaseSmartWalletMessage: [{ name: "hash", type: "bytes32" }],
    },
    primaryType: "CoinbaseSmartWalletMessage",
    message: { hash: permitHash },
  };
}

export async function recoverTradeSigner(
  typedData: CoinbaseSmartWalletTypedData,
  signature: Hex,
): Promise<Address> {
  if (!signaturePattern.test(signature)) reject();
  const r = BigInt(`0x${signature.slice(2, 66)}`);
  const s = BigInt(`0x${signature.slice(66, 130)}`);
  const v = Number.parseInt(signature.slice(130, 132), 16);
  if (
    r <= BigInt(0) || r >= SECP256K1_N ||
    s <= BigInt(0) || s > SECP256K1_N / BigInt(2) ||
    ![0, 1, 27, 28].includes(v)
  ) reject();
  try {
    return (await recoverTypedDataAddress({
      ...(typedData as unknown as Omit<Parameters<typeof recoverTypedDataAddress>[0], "signature">),
      signature: signature as ViemHex,
    })).toLowerCase() as Address;
  } catch {
    reject();
  }
}

export function wrapSmartAccountSignature(ownerIndex: number, signature: Hex): Hex {
  if (ownerIndex !== 0 || !signaturePattern.test(signature)) reject();
  return encodeAbiParameters(
    [{
      name: "signatureWrapper",
      type: "tuple",
      components: [
        { name: "ownerIndex", type: "uint256" },
        { name: "signatureData", type: "bytes" },
      ],
    }],
    [{ ownerIndex: BigInt(ownerIndex), signatureData: signature }],
  ).toLowerCase() as Hex;
}

export function appendPermit2Signature(calldata: Hex, wrapper: Hex): Hex {
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(calldata) || !/^0x(?:[0-9a-fA-F]{2})+$/.test(wrapper)) {
    reject();
  }
  const byteLength = (wrapper.length - 2) / 2;
  const lengthWord = byteLength.toString(16).padStart(64, "0");
  return `${calldata}${lengthWord}${wrapper.slice(2)}`.toLowerCase() as Hex;
}

export function nonceBitmapPosition(nonce: bigint): { wordPos: bigint; mask: bigint } {
  if (nonce < BigInt(0) || nonce > UINT256_MAX) reject();
  return {
    wordPos: nonce >> BigInt(8),
    mask: BigInt(1) << (nonce & BigInt(255)),
  };
}

function assertFields(value: unknown, expected: readonly { name: string; type: string }[]): void {
  if (!Array.isArray(value) || value.length !== expected.length) reject();
  for (let index = 0; index < expected.length; index += 1) {
    const field = value[index];
    if (
      !isRecord(field) ||
      Object.keys(field).sort().join(",") !== "name,type" ||
      field.name !== expected[index].name ||
      field.type !== expected[index].type
    ) reject();
  }
}

function parseUint(value: unknown): bigint {
  if (
    (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") ||
    (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0))
  ) reject();
  const text = String(value);
  if (!/^(?:0|[1-9][0-9]*)$/.test(text)) reject();
  const parsed = BigInt(text);
  if (parsed > UINT256_MAX) reject();
  return parsed;
}

function normalizeAddress(value: unknown): Address {
  if (typeof value !== "string" || !addressPattern.test(value)) reject();
  return value.toLowerCase() as Address;
}

function reject(): never {
  throw new TradePreparationError("quote-rejected");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
