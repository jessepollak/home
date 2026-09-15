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
  /** Codex resolved this wallet contract even when market-gate fields were absent. */
  marketDataResolved?: true;
  underlying?: Holding["underlying"];
};

export type BalancesUniverse = {
  entries: UniverseEntry[];
};

export type EnumeratedBalance = {
  contractAddress: `0x${string}`;
  amountBaseUnits: string;
  name?: string;
  symbol?: string;
  decimals?: number;
};

export type BalancesEnumeration = {
  status: "complete" | "incomplete" | "unavailable";
  rows: EnumeratedBalance[];
  /** Cursor for the next page when the bounded scan did not finish. */
  nextCursor: string | null;
  pagesRead: number;
  durationMs: number;
};

export type ReadHolding = UniverseEntry & {
  balance: HoldingBalance;
  underlyingBalance?: HoldingBalance;
};

export type BalancesRead = {
  block: { number: string; hash: `0x${string}`; timestamp: string };
  /** When the registry read pinned `block`, not when an observation was stored. */
  observedAt: string;
  holdings: ReadHolding[];
  coverage: BalancesCoverage;
  /** Next CDP page to read after a bounded partial enumeration. */
  enumerationCursor?: string | null;
};
