import { encodeAbiParameters, keccak256 } from "viem";
import type { MorphoAddress, MorphoMarketId } from "./config";

export function computeMorphoMarketId(params: {
  loanToken: MorphoAddress;
  collateralToken: MorphoAddress;
  oracle: MorphoAddress;
  irm: MorphoAddress;
  lltv: bigint;
}): MorphoMarketId {
  return keccak256(encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }],
    [params.loanToken, params.collateralToken, params.oracle, params.irm, params.lltv],
  ));
}
