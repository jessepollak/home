import "server-only";

import { encodeFunctionData, erc20Abi, parseAbi, recoverAddress } from "viem";
import type { Address, Hex } from "@/shared/trading/server-types";
import { PERMIT2_ADDRESS, TradePreparationError } from "./permit2";
import type { RfqMakerAuthorization } from "./quote";

const signatureAbi = parseAbi(["function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)"]);
const ZERO = "0x0000000000000000000000000000000000000000";
const signaturePattern = /^0x(?:[0-9a-fA-F]{2})+$/;

function eoaSignature(signature: Hex): Hex | null {
  if (!signaturePattern.test(signature)) return null;
  if (signature.length === 132) return ["1b", "1c"].includes(signature.slice(-2).toLowerCase()) ? signature : null;
  if (signature.length !== 130) return null;
  const high = Number.parseInt(signature.slice(66, 68), 16);
  const s = `${(high & 0x7f).toString(16).padStart(2, "0")}${signature.slice(68)}`;
  return `${signature.slice(0, 66)}${s}${high & 0x80 ? "1c" : "1b"}` as Hex;
}

export async function verifyRfqMakerAuthorizations(
  auths: readonly RfqMakerAuthorization[],
  read: (method: string, params: readonly unknown[]) => Promise<unknown>,
  blockTag: Hex,
): Promise<void> {
  const required = new Map<string, { maker: Address; token: Address; amount: bigint }>();
  for (const auth of auths) {
    let code: unknown;
    try {
      code = await read("eth_getCode", [auth.maker, blockTag]);
    } catch (error) {
      throw new TradePreparationError("provider-unavailable", error);
    }
    if (typeof code !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(code)) throw new TradePreparationError("provider-unavailable");
    if (code === "0x") {
      const signature = eoaSignature(auth.makerSig);
      if (!signature || auth.maker.toLowerCase() === ZERO) throw new TradePreparationError("unverified-actions");
      let signer: Address;
      try {
        signer = await recoverAddress({ hash: auth.digest, signature });
      } catch {
        throw new TradePreparationError("unverified-actions");
      }
      if (signer.toLowerCase() !== auth.maker.toLowerCase()) throw new TradePreparationError("unverified-actions");
    } else {
      let result: unknown;
      try {
        result = await read("eth_call", [{ to: auth.maker, data: encodeFunctionData({ abi: signatureAbi, functionName: "isValidSignature", args: [auth.digest, auth.makerSig] }) }, blockTag]);
      } catch (error) {
        throw new TradePreparationError("provider-unavailable", error);
      }
      if (typeof result !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(result)) throw new TradePreparationError("provider-unavailable");
      if (result.toLowerCase() !== `0x1626ba7e${"0".repeat(56)}`) throw new TradePreparationError("unverified-actions");
    }
    let bitmap: unknown;
    try {
      bitmap = await read("eth_call", [{
        to: PERMIT2_ADDRESS,
        data: `0x4fe02b44${auth.maker.slice(2).padStart(64, "0")}${(auth.permit.nonce >> BigInt(8)).toString(16).padStart(64, "0")}`,
      }, blockTag]);
    } catch (error) {
      throw new TradePreparationError("provider-unavailable", error);
    }
    if (typeof bitmap !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(bitmap)) throw new TradePreparationError("provider-unavailable");
    if ((BigInt(bitmap) & (BigInt(1) << (auth.permit.nonce & BigInt(255)))) !== BigInt(0)) {
      throw new TradePreparationError("quote-rejected");
    }
    const key = `${auth.maker.toLowerCase()}:${auth.permit.permitted.token.toLowerCase()}`;
    const entry = required.get(key) ?? { maker: auth.maker, token: auth.permit.permitted.token, amount: BigInt(0) };
    entry.amount += auth.permit.permitted.amount;
    required.set(key, entry);
  }
  for (const { maker, token, amount } of required.values()) {
    let balance: bigint;
    let allowance: bigint;
    try {
      const readWord = async (data: Hex): Promise<bigint> => {
        const result = await read("eth_call", [{ to: token, data }, blockTag]);
        if (typeof result !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(result)) throw new Error("Invalid maker token read");
        return BigInt(result);
      };
      balance = await readWord(encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [maker] }));
      allowance = await readWord(encodeFunctionData({ abi: erc20Abi, functionName: "allowance", args: [maker, PERMIT2_ADDRESS] }));
    } catch (error) {
      throw new TradePreparationError("provider-unavailable", error);
    }
    if (balance < amount || allowance < amount) throw new TradePreparationError("stale-quote");
  }
}
