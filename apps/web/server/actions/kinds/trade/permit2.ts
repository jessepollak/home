import "server-only";

import {
  encodeAbiParameters,

  recoverTypedDataAddress,
  type Hex as ViemHex,
} from "viem";
import type {
  Address,
  CoinbaseSmartWalletTypedData,
  Hex,

} from "@/shared/trading/server-types";
export type TradePreparationFailure =
  | "invalid-request"
  | "stock-eligibility"
  | "smart-account-unavailable"
  | "signer-unsupported"
  | "insufficient-balance"
  | "no-liquidity"
  | "stale-quote"
  | "quote-rejected"
  | "permit-expired"
  | "permit-used"
  | "invalid-finalization"
  | "provider-unavailable";

export class TradePreparationError extends Error {
  readonly reason: TradePreparationFailure;

  constructor(reason: TradePreparationFailure, cause?: unknown) {
    super(reason, { cause });
    this.name = "TradePreparationError";
    this.reason = reason;
  }
}

const signaturePattern = /^0x[0-9a-fA-F]{130}$/;
const SECP256K1_N = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");

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
      ...(typedData as Omit<Parameters<typeof recoverTypedDataAddress>[0], "signature">),
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

function reject(): never {
  throw new TradePreparationError("quote-rejected");
}
