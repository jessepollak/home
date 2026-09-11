export const RIPIO_COUNTRIES = ["AR", "BR", "CO"] as const;
export type RipioCountry = (typeof RIPIO_COUNTRIES)[number];

export const RIPIO_BASE_CHAIN = "BASE" as const;
export const RIPIO_BASE_CHAIN_ID = 8453 as const;

export const RIPIO_ASSETS = {
  AR: {
    fiatCurrency: "ARS",
    token: "wARS",
    tokenAddress: "0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D",
    decimals: 18,
    paymentMethods: ["bank_transfer"] as const,
  },
  CO: {
    fiatCurrency: "COP",
    token: "wCOP",
    tokenAddress: "0x8a1D45e102e886510e891d2Ec656a708991e2D76",
    decimals: 18,
    paymentMethods: ["bank_transfer", "breb", "r2p_bancolombia", "r2p_nequi"] as const,
  },
} as const;

export type RipioEnabledCountry = keyof typeof RIPIO_ASSETS;
export type RipioPaymentMethod =
  | "bank_transfer"
  | "breb"
  | "r2p_bancolombia"
  | "r2p_nequi";

export type RipioAvailability =
  | {
      available: true;
      country: RipioEnabledCountry;
      fiatCurrency: "ARS" | "COP";
      token: "wARS" | "wCOP";
      tokenAddress: `0x${string}`;
      chain: typeof RIPIO_BASE_CHAIN;
      chainId: typeof RIPIO_BASE_CHAIN_ID;
      requiresTermsAcceptance: true;
      requiresKyc: true;
    }
  | {
      available: false;
      country: RipioCountry;
      reason: "unsupported-region" | "brazil-asset-unresolved";
    };

export function ripioAvailability(region: string): RipioAvailability | null {
  if (region !== "AR" && region !== "BR" && region !== "CO") return null;
  if (region === "BR") {
    return { available: false, country: "BR", reason: "brazil-asset-unresolved" };
  }
  const asset = RIPIO_ASSETS[region];
  return {
    available: true,
    country: region,
    fiatCurrency: asset.fiatCurrency,
    token: asset.token,
    tokenAddress: asset.tokenAddress,
    chain: RIPIO_BASE_CHAIN,
    chainId: RIPIO_BASE_CHAIN_ID,
    requiresTermsAcceptance: true,
    requiresKyc: true,
  };
}

export type RipioQuoteRequest = {
  country: RipioEnabledCountry;
  fromCurrency: "ARS" | "COP";
  toCurrency: "wARS" | "wCOP";
  fromAmount: string;
  chain: typeof RIPIO_BASE_CHAIN;
  paymentMethodType: RipioPaymentMethod;
  destination: `0x${string}`;
};

export type RipioQuote = {
  quoteId: string;
  fromCurrency: string;
  toCurrency: string;
  fromAmount: string;
  finalFromAmount: string;
  toAmount: string;
  finalToAmount: string;
  rate: string;
  expiration: string;
  fees: Array<{
    amount: string;
    type: string;
    currency: string;
    appliesOnFromAmount: boolean;
    appliesOnToAmount: boolean;
  }>;
};

export type RipioRailInstructions =
  | { kind: "ar-bank-transfer"; cvu: string; alias?: string }
  | { kind: "co-payment-url"; paymentUrl: string }
  | { kind: "co-breb"; brebKey: string }
  | { kind: "co-r2p-nequi"; phoneNumber: string };

export type RipioOrderState =
  | "awaiting-payment"
  | "payment-received"
  | "converting"
  | "sending"
  | "sent-unverified"
  | "received"
  | "cancelled"
  | "refund-pending"
  | "refund-rejected"
  | "refunded"
  | "outage"
  | "unknown";

export type RipioBaseTransferEvidence = {
  chainId: typeof RIPIO_BASE_CHAIN_ID;
  transactionHash: `0x${string}`;
  tokenAddress: `0x${string}`;
  destination: `0x${string}`;
  amountAtomic: string;
  blockNumber: string;
  confirmations: number;
};

export function exactRipioEntitlement(input: RipioQuoteRequest): boolean {
  const asset = RIPIO_ASSETS[input.country];
  return (
    input.fromCurrency === asset.fiatCurrency &&
    input.toCurrency === asset.token &&
    input.chain === RIPIO_BASE_CHAIN &&
    /^0x[0-9a-fA-F]{40}$/.test(input.destination) &&
    asset.paymentMethods.includes(input.paymentMethodType as never) &&
    isPositiveDecimal(input.fromAmount)
  );
}

export function exactBaseTransferMatches(input: {
  evidence: RipioBaseTransferEvidence;
  destination: `0x${string}`;
  tokenAddress: `0x${string}`;
  amountAtomic: string;
  minimumConfirmations: number;
}): boolean {
  const { evidence } = input;
  return (
    evidence.chainId === RIPIO_BASE_CHAIN_ID &&
    evidence.destination.toLowerCase() === input.destination.toLowerCase() &&
    evidence.tokenAddress.toLowerCase() === input.tokenAddress.toLowerCase() &&
    evidence.amountAtomic === input.amountAtomic &&
    evidence.confirmations >= input.minimumConfirmations &&
    /^0x[0-9a-fA-F]{64}$/.test(evidence.transactionHash) &&
    /^(0|[1-9][0-9]*)$/.test(evidence.blockNumber)
  );
}

function isPositiveDecimal(value: string): boolean {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) return false;
  return /[1-9]/.test(value);
}
