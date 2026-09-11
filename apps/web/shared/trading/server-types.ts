import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type {
  MoneyActionDraft,
  MoneyActionOwner,
  PreparedMoneyAction,
} from "@/shared/money-actions/types";
import type { PrepareTradeRequest, TradeIntentReview } from "@/shared/trading/types";

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

export type TradeFee = {
  amount: bigint;
  token: Address;
};

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

export type TradeQuote =
  | { liquidityAvailable: false }
  | {
      liquidityAvailable: true;
      network: string;
      fromToken: Address;
      toToken: Address;
      fromAmount: bigint;
      toAmount: bigint;
      minToAmount: bigint;
      blockNumber: bigint;
      fees: {
        gasFee?: TradeFee;
        protocolFee?: TradeFee;
      };
      issues: {
        allowance?: { currentAllowance: bigint; spender: Address };
        balance?: {
          token: Address;
          currentBalance: bigint;
          requiredBalance: bigint;
        };
        simulationIncomplete: boolean;
      };
      transaction?: {
        to: Address;
        data: Hex;
        value: bigint;
        gas: bigint;
        gasPrice: bigint;
      };
      permit2?: {
        hash: Hex;
        eip712: unknown;
      };
    };

export type TradeQuoteRequest = {
  network: "base";
  fromToken: Address;
  toToken: Address;
  fromAmount: bigint;
  taker: Address;
  signerAddress: Address;
  slippageBps: number;
  idempotencyKey?: string;
};

export type TradeQuoteClient = {
  createSwapQuote(request: TradeQuoteRequest): Promise<TradeQuote>;
};

export type TradeBalanceSnapshot = {
  address: Address;
  token: Address;
  balance: bigint;
  blockNumber: bigint;
};

export type TradeBalanceReader = (
  address: Address,
  token: Address,
  signal?: AbortSignal,
) => Promise<TradeBalanceSnapshot>;

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

export type Permit2StateReader = (
  owner: Address,
  nonce: bigint,
  signal?: AbortSignal,
) => Promise<{ blockNumber: bigint; used: boolean }>;

export type SmartAccountSignatureVerifier = (input: {
  smartAccount: Address;
  permitHash: Hex;
  wrapper: Hex;
  signal?: AbortSignal;
}) => Promise<boolean>;

export type TradeIntent = {
  version: 1;
  id: string;
  intentHash: string;
  owner: MoneyActionOwner;
  signer: VerifiedTradeSigner;
  request: PrepareTradeRequest;
  quoteId: string;
  quoteBlockNumber: string;
  balanceBlockNumber: string;
  sellToken: Address;
  spendAmount: string;
  permitHash: Hex;
  permit: Permit2TypedData;
  signingTypedData: CoinbaseSmartWalletTypedData;
  permitDeadline: string;
  createdAt: string;
  expiresAt: string;
  swapCallIndex: number;
  draft: MoneyActionDraft;
  reservedActionId: string;
  reservedActionCreatedAt: string;
  finalActionId?: string;
  signatureDigest?: string;
};

export type TradeIntentStore = {
  issue(intent: TradeIntent): Promise<void>;
  get(owner: MoneyActionOwner, id: string): Promise<TradeIntent | null>;
  getByFinalActionId(owner: MoneyActionOwner, actionId: string): Promise<TradeIntent | null>;
  bindFinalAction(input: {
    owner: MoneyActionOwner;
    id: string;
    intentHash: string;
    finalActionId: string;
    signatureDigest: string;
  }): Promise<TradeIntent | null>;
};

export type IssueTradeAction = (
  session: VerifiedAccountSession,
  draft: MoneyActionDraft,
  options: {
    sensitivePayloadExpiresAt: string;
    actionId: string;
    createdAt: string;
  },
) => Promise<PreparedMoneyAction>;

export type PrepareTradeDependencies = {
  quoteClient: TradeQuoteClient;
  readBalance: TradeBalanceReader;
  readPermit2State: Permit2StateReader;
  resolveSigner: TradeSignerResolver;
  intentStore: TradeIntentStore;
  now?: () => Date;
};

export type PrepareTradeInput = {
  httpRequest: Request;
  session: VerifiedAccountSession;
  request: PrepareTradeRequest;
  signal?: AbortSignal;
};

export type FinalizeTradeDependencies = {
  readBalance: TradeBalanceReader;
  readPermit2State: Permit2StateReader;
  resolveSigner: TradeSignerResolver;
  verifySmartAccountSignature: SmartAccountSignatureVerifier;
  intentStore: TradeIntentStore;
  issueAction: IssueTradeAction;
  now?: () => Date;
};

export type FinalizeTradeInput = {
  httpRequest: Request;
  session: VerifiedAccountSession;
  intentId: string;
  intentHash: string;
  signature: Hex;
  signal?: AbortSignal;
};

export type PreparedTradeIntent = TradeIntentReview;
