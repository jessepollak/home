import type { VerifiedAccountSession } from "@/shared/account/session-types";

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

export type Permit2TypedData = {
  domain: {
    name: "Permit2";
    chainId: 8453;
    verifyingContract: Address;
  };
  types: {
    EIP712Domain?: readonly [
      { readonly name: "name"; readonly type: "string" },
      { readonly name: "chainId"; readonly type: "uint256" },
      { readonly name: "verifyingContract"; readonly type: "address" },
    ];
    PermitTransferFrom: readonly [
      { readonly name: "permitted"; readonly type: "TokenPermissions" },
      { readonly name: "spender"; readonly type: "address" },
      { readonly name: "nonce"; readonly type: "uint256" },
      { readonly name: "deadline"; readonly type: "uint256" },
    ];
    TokenPermissions: readonly [
      { readonly name: "token"; readonly type: "address" },
      { readonly name: "amount"; readonly type: "uint256" },
    ];
  };
  primaryType: "PermitTransferFrom";
  message: {
    permitted: { token: Address; amount: string };
    spender: Address;
    nonce: string;
    deadline: string;
  };
};

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
