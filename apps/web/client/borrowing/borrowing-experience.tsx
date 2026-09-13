"use client";

import Link from "next/link";
import {
  Button,
  EmptyState,
  Field,
  Heading,
  Inline,
  Input,
  ListRow,
  Select,
  StatusMessage,
  Text,
} from "@home/ui";
import { MoneyTicker } from "@home/ui/money-ticker";
import { useMemo, useState } from "react";
import { useAccountWallet } from "@/client/account/cdp-client";
import { dataOwnerKey as ownerDataKey } from "@/client/account/owner-keys";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { MoneyActionReview } from "@/client/actions/review";
import type { OperationResult, PreparedMoneyAction } from "@/shared/money-actions/types";
import {
  formatHealthFactor,
  formatOracleUsd,
  formatPresentationDate,
  formatPresentationTokenAmount,
  formatWadPercent,
} from "@/shared/formatting";
import {
  readAnonymousCountryPreference,
} from "@/config/country-preference";
import {
  resolvePresentation,
  type RegionId,
} from "@/config/regions";
import {
  BORROW_COLLATERAL_TOKEN,
  BORROW_LOAN_TOKEN,
} from "@/shared/borrowing/config";
import type {
  BorrowOperation,
  BorrowPreviewResponse,
} from "@/shared/borrowing/types";
import { parseSnapshot, type BorrowMarketSnapshot } from "@/shared/borrowing/contract";
import styles from "./borrowing-experience.module.css";
import { ownerQueryKey, ownerQueryMeta, useHomeQuery } from "@/client/query/query-client";

type FetchAccountResource = (
  path: string,
  options?: {
    method?: "GET" | "POST";
    body?: unknown;
    signal?: AbortSignal;
  },
) => Promise<unknown>;

type BorrowExperienceProps = {
  session: VerifiedAccountSession | null;
  fetchAccountResource?: FetchAccountResource;
  prepareMoneyAction?: (kind: string, params: unknown) => Promise<PreparedMoneyAction>;
  executeMoneyAction?: (action: PreparedMoneyAction) => Promise<OperationResult>;
  regionId?: RegionId;
};

type SnapshotState =
  | { status: "idle" | "loading"; snapshot: null }
  | { status: "ready"; snapshot: BorrowMarketSnapshot }
  | { status: "error"; snapshot: null };

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "preview-only"; response: Extract<BorrowPreviewResponse, { status: "preview-only" }> }
  | { status: "prepared"; action: PreparedMoneyAction };

type LimitPresentation = {
  value: string;
  suffix: string;
  secondValue?: string;
  secondSuffix?: string;
};

/** Not routed today (D4: `/borrow` deleted); retained for a future Borrow shell panel. */
export function AuthenticatedBorrowExperience() {
  const account = useAccountWallet();
  const regionId = usePersistedPresentationRegion();
  return (
    <BorrowExperience
      session={account.status === "verified" ? account.session : null}
      fetchAccountResource={account.fetchAccountResource}
      prepareMoneyAction={account.prepareMoneyAction}
      executeMoneyAction={account.executeMoneyAction}
      regionId={regionId}
    />
  );
}

export function BorrowExperience(props: BorrowExperienceProps) {
  const sessionKey = props.session?.smartAccount
    ? ownerDataKey(props.session)
    : "signed-out";
  return <BorrowExperienceInner key={sessionKey} {...props} />;
}

function BorrowExperienceInner({
  session,
  fetchAccountResource,
  prepareMoneyAction,
  executeMoneyAction,
  regionId = "GLOBAL",
}: BorrowExperienceProps) {
  const owner = session?.smartAccount?.address ?? null;
  const sessionKey = session?.smartAccount ? ownerDataKey(session) : null;
  const dataOwnerKey = sessionKey;
  const snapshotQuery = useHomeQuery({
    queryKey: dataOwnerKey ? ownerQueryKey(dataOwnerKey, "borrow") : ["unauthenticated", "borrow-disabled"],
    enabled: Boolean(sessionKey && fetchAccountResource && owner),
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
    meta: dataOwnerKey ? ownerQueryMeta(dataOwnerKey, "owner") : undefined,
    queryFn: ({ signal }) => {
      if (!fetchAccountResource) throw new Error("Borrowing is unavailable.");
      return fetchAccountResource("/api/borrow", { signal });
    },
    select: (value) => {
      if (!owner) throw new Error("Borrowing is unavailable.");
      const snapshot = parseSnapshot(value, owner);
      if (!snapshot) throw new Error("Borrowing response is invalid.");
      return snapshot;
    },
  });
  const state: SnapshotState = !sessionKey
    ? { status: "idle", snapshot: null }
    : snapshotQuery.isPending
      ? { status: "loading", snapshot: null }
      : snapshotQuery.isError
        ? { status: "error", snapshot: null }
        : { status: "ready", snapshot: snapshotQuery.data };
  const [operation, setOperation] = useState<BorrowOperation>("supply-collateral");
  const [amount, setAmount] = useState("");
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });

  const refresh = () => snapshotQuery.refetch();

  const snapshot = state.status === "ready" ? state.snapshot : null;
  const actionAsset = operation === "supply-collateral" || operation === "withdraw-collateral"
    ? BORROW_COLLATERAL_TOKEN
    : BORROW_LOAN_TOKEN;
  const emptyWallet = snapshot !== null &&
    BigInt(snapshot.wallet.collateralBalanceRaw) === BigInt("0") &&
    BigInt(snapshot.wallet.loanBalanceRaw) === BigInt("0") &&
    BigInt(snapshot.position.collateralRaw) === BigInt("0") &&
    BigInt(snapshot.position.borrowSharesRaw) === BigInt("0");

  async function submitPreview(event: React.FormEvent) {
    event.preventDefault();
    if (!snapshot || !prepareMoneyAction) return;
    setPreview({ status: "loading" });
    try {
      const action = await prepareMoneyAction(operation === "repay-all" ? "repay" : operation, {
        operation,
        amount,
        snapshotBlockHash: snapshot.source.blockHash,
      });
      setPreview({ status: "prepared", action });
    } catch (error) {
      setPreview({
        status: "error",
        message: readableResourceError(error),
      });
    }
  }

  const selectedLimit = useMemo<LimitPresentation | null>(() => {
    if (!snapshot) return null;
    switch (operation) {
      case "supply-collateral":
        return {
          value: formatPresentationTokenAmount(snapshot.wallet.collateralBalanceRaw, 8, "cbBTC", { regionId, useNoBreakSpace: true }),
          suffix: "wallet balance",
        };
      case "borrow":
        return {
          value: formatPresentationTokenAmount(snapshot.position.borrowCapacityAssetsRaw, 6, "USDC", { cashCurrency: "USD", regionId, useNoBreakSpace: true }),
          suffix: "current capacity",
        };
      case "repay":
        return {
          value: formatPresentationTokenAmount(snapshot.position.debtAssetsRaw, 6, "USDC", { cashCurrency: "USD", regionId, useNoBreakSpace: true }),
          suffix: "current debt; enter less for an exact partial repayment",
        };
      case "repay-all":
        return {
          value: formatPresentationTokenAmount(snapshot.position.debtAssetsRaw, 6, "USDC", { cashCurrency: "USD", regionId, useNoBreakSpace: true }),
          suffix: "current debt estimate; maximum cannot exceed",
          secondValue: formatPresentationTokenAmount(snapshot.wallet.loanBalanceRaw, 6, "USDC", { cashCurrency: "USD", regionId, useNoBreakSpace: true }),
          secondSuffix: "wallet balance",
        };
      case "withdraw-collateral":
        return {
          value: formatPresentationTokenAmount(snapshot.position.withdrawableCollateralRaw, 8, "cbBTC", { regionId, useNoBreakSpace: true }),
          suffix: "currently withdrawable",
        };
    }
  }, [operation, snapshot, regionId]);

  return (
    <main className={styles.page}>
      <section className={styles.experience} aria-labelledby="borrow-title">
        <nav className={styles.chrome} aria-label="Borrow navigation">
          <Link href="/dashboard">← Dashboard</Link>
          <Text as="span" textStyle="metadata" tone="muted">Home · Base</Text>
        </nav>
        <header className={styles.header}>
          <Heading level={1} textStyle="page-title" id="borrow-title">USDC against cbBTC</Heading>
        </header>

        {!sessionKey ? (
          <StatusMessage className={styles.notice} title="Sign in to view this wallet’s position" />
        ) : null}
        {sessionKey && state.status === "loading" ? (
          <StatusMessage className={styles.notice} title="Loading current market state" />
        ) : null}
        {sessionKey && state.status === "error" ? (
          <StatusMessage
            className={styles.notice}
            tone="error"
            role="alert"
            title="Borrowing state unavailable"
            action={<Button type="button" variant="secondary" onClick={() => void refresh()}>Retry</Button>}
          >
            Refresh to try again.
          </StatusMessage>
        ) : null}

        {snapshot ? (
          <>
            <div className={styles.asOf}>
              <Text as="span" textStyle="metadata" tone="muted">
                <time dateTime={blockTime(snapshot.source.blockTimestamp)}>As of {formatTime(blockTime(snapshot.source.blockTimestamp), regionId)}</time>
              </Text>
            </div>
            <section className={styles.metrics} aria-labelledby="position-title">
              <Inline className={styles.sectionHeading} space="3">
                <Heading level={2} textStyle="section-title" id="position-title">Wallet and position</Heading>
                <Button type="button" variant="secondary" onClick={() => void refresh()}>Refresh</Button>
              </Inline>
              {emptyWallet ? (
                <EmptyState
                  className={styles.empty}
                  title="This wallet has no cbBTC, USDC, or borrow position."
                />
              ) : null}
              <ul className={styles.metricGrid}>
                <Metric label="cbBTC wallet" value={formatPresentationTokenAmount(snapshot.wallet.collateralBalanceRaw, 8, "cbBTC", { regionId, useNoBreakSpace: true })} money />
                <Metric label="USDC wallet" value={formatPresentationTokenAmount(snapshot.wallet.loanBalanceRaw, 6, "USDC", { cashCurrency: "USD", regionId, useNoBreakSpace: true })} money />
                <Metric label="Collateral supplied" value={formatPresentationTokenAmount(snapshot.position.collateralRaw, 8, "cbBTC", { regionId, useNoBreakSpace: true })} money />
                <Metric label="Current debt" value={formatPresentationTokenAmount(snapshot.position.debtAssetsRaw, 6, "USDC", { cashCurrency: "USD", regionId, useNoBreakSpace: true })} note="Rounded up from Morpho borrow shares" money />
                <Metric label="Current borrow capacity" value={formatPresentationTokenAmount(snapshot.position.borrowCapacityAssetsRaw, 6, "USDC", { cashCurrency: "USD", regionId, useNoBreakSpace: true })} note="Lower of collateral limit and indexed liquidity" money />
                <Metric label="Currently withdrawable" value={formatPresentationTokenAmount(snapshot.position.withdrawableCollateralRaw, 8, "cbBTC", { regionId, useNoBreakSpace: true })} note="At the displayed oracle price" money />
                <Metric label="Health factor" value={formatHealthFactor(snapshot.position.healthFactorWad, regionId)} note={healthNote(snapshot.position.healthFactorWad)} />
                <Metric label="Liquidation price" value={snapshot.position.liquidationPriceRaw ? `${formatOracleUsd(snapshot.position.liquidationPriceRaw, regionId)} / cbBTC` : "No debt"} money={snapshot.position.liquidationPriceRaw !== null} />
                <Metric label="Oracle price" value={`${formatOracleUsd(snapshot.state.oraclePriceRaw, regionId)} / cbBTC`} money />
                <Metric label="Variable borrow APR" value={formatWadPercent(snapshot.state.borrowAprWad, regionId)} note="Current per-second rate annualized; not fixed" />
                <Metric label="Indexed liquidity" value={formatPresentationTokenAmount(snapshot.state.liquidityAssetsRaw, 6, "USDC", { cashCurrency: "USD", regionId, useNoBreakSpace: true })} money />
                <Metric label="Market state updated" value={formatTime(blockTime(snapshot.state.lastUpdateTimestamp), regionId)} />
              </ul>
            </section>

            <form className={styles.form} onSubmit={submitPreview}>
              <Heading level={2} textStyle="section-title">Preview action</Heading>
              <Field label="Action" htmlFor="borrow-operation" required>
                <Select id="borrow-operation" value={operation} onChange={(event) => { setOperation(event.target.value as BorrowOperation); setAmount(""); setPreview({ status: "idle" }); }}>
                  <option value="supply-collateral">Supply cbBTC collateral</option>
                  <option value="borrow">Borrow USDC</option>
                  <option value="repay">Repay USDC (partial)</option>
                  <option value="repay-all">Repay all USDC debt</option>
                  <option value="withdraw-collateral">Withdraw cbBTC collateral</option>
                </Select>
              </Field>
              <Field
                label={`${operation === "repay-all" ? "Maximum debit" : "Amount"} (${actionAsset.symbol})`}
                htmlFor="borrow-amount"
                required
              >
                <Input
                  id="borrow-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  onChange={(event) => { setAmount(event.target.value); setPreview({ status: "idle" }); }}
                  placeholder={actionAsset.decimals === 8 ? "0.00000000" : "0.00"}
                />
              </Field>
              {selectedLimit ? (
                <Text as="p" textStyle="metadata" tone="muted" className={styles.limit}>
                  <MoneyTicker value={selectedLimit.value} /> {selectedLimit.suffix}
                  {selectedLimit.secondValue ? (
                    <> <MoneyTicker value={selectedLimit.secondValue} /> {selectedLimit.secondSuffix}</>
                  ) : null}
                </Text>
              ) : null}
              <Button type="submit" disabled={!amount.trim() || preview.status === "loading"}>
                {preview.status === "loading" ? "Checking RPC simulation…" : "Review current preview"}
              </Button>
            </form>
          </>
        ) : null}

        {preview.status === "error" ? (
          <StatusMessage
            className={styles.notice}
            tone="error"
            role="alert"
            title="Preview unavailable"
          >
            {preview.message}
          </StatusMessage>
        ) : null}
        {preview.status === "preview-only" ? (
          <section className={styles.previewOnly} aria-labelledby="preview-only-title">
            <Heading level={2} textStyle="section-title" id="preview-only-title">Read-only preview</Heading>
            <Text as="strong" textStyle="row-label">{preview.response.preview.title}</Text>
            <Text as="span" textStyle="row-value">
              <MoneyTicker value={formatPresentationTokenAmount(preview.response.preview.amount.amountBaseUnits, preview.response.preview.amount.decimals, preview.response.preview.amount.symbol, { regionId, useNoBreakSpace: true })} />
            </Text>
            <ul>
              {preview.response.preview.warnings.map((warning) => (
                <li key={warning}><Text as="span" textStyle="secondary" tone="muted">{warning}</Text></li>
              ))}
            </ul>
            <Text as="p" textStyle="secondary" tone="muted">{preview.response.preview.disabledReason}</Text>
          </section>
        ) : null}
      </section>

      {preview.status === "prepared" ? (
        <MoneyActionReview
          action={preview.action}
          execute={executeMoneyAction}
          onClose={() => setPreview({ status: "idle" })}
          onConfirmed={() => {
            setPreview({ status: "idle" });
            setAmount("");
          }}
        />
      ) : null}
    </main>
  );
}

function Metric({
  label,
  value,
  note,
  money = false,
}: {
  label: string;
  value: string;
  note?: string;
  money?: boolean;
}) {
  return (
    <ListRow
      leading={null}
      label={label}
      description={note}
      value={money ? <MoneyTicker value={value} /> : value}
    />
  );
}

function healthNote(raw: string | null) {
  if (raw === null) return "No active liquidation threshold";
  const health = BigInt(raw);
  if (health < BigInt("1000000000000000000")) return "At or below the indexed liquidation threshold";
  if (health < BigInt("1100000000000000000")) return "Very close to liquidation";
  if (health < BigInt("1250000000000000000")) return "Limited liquidation buffer";
  return "Above the indexed liquidation threshold";
}

function blockTime(seconds: string) {
  return new Date(Number(seconds) * 1_000).toISOString();
}

function formatTime(value: string, regionId: RegionId) {
  return formatPresentationDate(value, { regionId, style: "date-time-zone" });
}

function usePersistedPresentationRegion(): RegionId {
  const [regionId] = useState<RegionId>(() => {
    if (typeof window === "undefined") return "GLOBAL";
    return resolvePresentation({
      persistedCountry: readAnonymousCountryPreference(
        () => window.localStorage,
      ),
    }).region.id;
  });
  return regionId;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function readableResourceError(error: unknown) {
  if (error instanceof Error && error.message && error.message !== "Authenticated resource is unavailable.") return error.message;
  return "The current limit or RPC simulation could not be verified. Refresh and try again.";
}
