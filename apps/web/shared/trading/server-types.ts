import type { VerifiedAccountSession } from "@/shared/account/session-types";

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

export type CoinbaseSmartWalletTypedData = {
  domain: {
    name: "Coinbase Smart Wallet";
    version: "1";
    chainId: 8453;
    verifyingContract: Address;
  };
  types: {
    EIP712Domain: readonly [
      { readonly name: "name"; readonly type: "string" },
      { readonly name: "version"; readonly type: "string" },
      { readonly name: "chainId"; readonly type: "uint256" },
      { readonly name: "verifyingContract"; readonly type: "address" },
    ];
    CoinbaseSmartWalletMessage: readonly [
      { readonly name: "hash"; readonly type: "bytes32" },
    ];
  };
  primaryType: "CoinbaseSmartWalletMessage";
  message: { hash: Hex };
};

export type VerifiedTradeSigner = {
  smartAccount: Address;
  signerAddress: Address;
  ownerIndex: 0;
  deployed: boolean;
};

export type TradeSignerResolver = (
  request: Request,
  session: VerifiedAccountSession,
  signal?: AbortSignal,
) => Promise<VerifiedTradeSigner>;

export type SmartAccountSignatureVerifier = (input: {
  smartAccount: Address;
  permitHash: Hex;
  wrapper: Hex;
  signal?: AbortSignal;
}) => Promise<boolean>;
