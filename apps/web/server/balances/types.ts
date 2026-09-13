import "server-only";

import type { FiatCurrencyCode } from "@/config/regions";
import type {
  AssetKey,
  BalancesCoverage,
  ExactDecimal,
  Holding,
  HoldingBalance,
  HoldingKind,
  HoldingSource,
} from "@/shared/balances/types";

export type UniverseEntry = {
  key: AssetKey;
  kind: HoldingKind;
  source: HoldingSource;
  id: string;
  name: string;
  symbol: string;
  decimals: number;
  contractAddress: `0x${string}` | null;
  cashCurrency: FiatCurrencyCode | null;
  imageUrl?: string;
  liquidityUsd?: ExactDecimal;
  volume24Usd?: ExactDecimal;
  underlying?: Holding["underlying"];
};

export type BalancesUniverse = {
  entries: UniverseEntry[];
  catalogStatus: BalancesCoverage["catalog"];
};

export type ReadHolding = UniverseEntry & {
  balance: HoldingBalance;
  underlyingBalance?: HoldingBalance;
};

export type BalancesRead = {
  block: { number: string; hash: `0x${string}`; timestamp: string };
  holdings: ReadHolding[];
  coverage: BalancesCoverage;
};
