"use client";

import Link from "next/link";
import { Button, Heading, Text } from "@home/ui";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CopyableValue } from "@/components/copyable-value";
import { useAccountWallet } from "@/client/account/cdp-client";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { MoneyActionReview } from "@/client/money-actions/review";
import { useMoneyDataRefresh } from "@/client/money-actions/refresh";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { formatAddress } from "@/shared/formatting";
import {
  BORROW_COLLATERAL_TOKEN,
  BORROW_LLTV_WAD,
  BORROW_LOAN_TOKEN,
  BORROW_MARKET_ID,
  BORROW_ORACLE_ADDRESS,
  MORPHO_BLUE_ADDRESS,
} from "@/shared/borrowing/config";
import type {
  BorrowMarketSnapshot,
  BorrowOperation,
  BorrowPreviewResponse,
} from "@/shared/borrowing/types";
import styles from "./borrowing-experience.module.css";

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
  onActionConfirmed?: () => void;
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

export function AuthenticatedBorrowExperience() {
  const account = useAccountWallet();
  const refreshMoneyData = useMoneyDataRefresh();
  return (
    <BorrowExperience
      session={account.status === "verified" ? account.session : null}
      fetchAccountResource={account.fetchAccountResource}
      onActionConfirmed={refreshMoneyData}
    />
  );
}

export function BorrowExperience(props: BorrowExperienceProps) {
  const owner = props.session?.smartAccount?.address ?? null;
  const sessionKey = props.session && owner
    ? `${props.session.user.subject}:${props.session.accountProvider}:${owner}`
    : "signed-out";
  return <BorrowExperienceInner key={sessionKey} {...props} />;
}

function BorrowExperienceInner({ session, fetchAccountResource, onActionConfirmed }: BorrowExperienceProps) {
  const owner = session?.smartAccount?.address ?? null;
  const sessionKey = session && owner
    ? `${session.user.subject}:${session.accountProvider}:${owner}`
    : null;
  const [state, setState] = useState<SnapshotState>(
    sessionKey ? { status: "loading", snapshot: null } : { status: "idle", snapshot: null },
  );
  const [operation, setOperation] = useState<BorrowOperation>("supply-collateral");
  const [amount, setAmount] = useState("");
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });

  const loadSnapshot = useCallback(async (signal?: AbortSignal) => {
    if (!owner || !fetchAccountResource) return;
    try {
      const value = await fetchAccountResource("/api/borrow", { signal });
      if (signal?.aborted) return;
      const snapshot = parseSnapshot(value, owner);
      setState(snapshot ? { status: "ready", snapshot } : { status: "error", snapshot: null });
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) return;
      setState({ status: "error", snapshot: null });
    }
  }, [fetchAccountResource, owner]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setState({ status: "loading", snapshot: null });
    await loadSnapshot(signal);
  }, [loadSnapshot]);

  useEffect(() => {
    if (!sessionKey || !fetchAccountResource || !owner) return;
    const controller = new AbortController();
    void fetchAccountResource("/api/borrow", { signal: controller.signal })
      .then((value) => {
        if (controller.signal.aborted) return;
        const snapshot = parseSnapshot(value, owner);
        setState(snapshot ? { status: "ready", snapshot } : { status: "error", snapshot: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setState({ status: "error", snapshot: null });
      });
    return () => controller.abort();
  }, [fetchAccountResource, owner, sessionKey]);

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
    if (!snapshot || !fetchAccountResource) return;
    setPreview({ status: "loading" });
    try {
      const value = await fetchAccountResource("/api/borrow", {
        method: "POST",
        body: {
          operation,
          amount,
          snapshotBlockHash: snapshot.source.blockHash,
        },
      });
      const response = parsePreviewResponse(value, owner!);
      if (!response) {
        setPreview({ status: "error", message: "The borrowing preview response was invalid." });
        return;
      }
      if (response.status === "prepared") {
        setState({ status: "ready", snapshot: response.snapshot });
        setPreview({ status: "prepared", action: response.action });
      } else {
        setState({ status: "ready", snapshot: response.snapshot });
        setPreview({ status: "preview-only", response });
      }
    } catch (error) {
      setPreview({
        status: "error",
        message: readableResourceError(error),
      });
    }
  }

  const selectedLimit = useMemo(() => {
    if (!snapshot) return null;
    switch (operation) {
      case "supply-collateral": return `${formatUnits(snapshot.wallet.collateralBalanceRaw, 8)} cbBTC wallet balance`;
      case "borrow": return `${formatUnits(snapshot.position.borrowCapacityAssetsRaw, 6)} USDC current capacity`;
      case "repay": return `${formatUnits(snapshot.position.debtAssetsRaw, 6)} USDC current debt; enter less for an exact partial repayment`;
      case "repay-all": return `${formatUnits(snapshot.position.debtAssetsRaw, 6)} USDC current debt estimate; maximum cannot exceed ${formatUnits(snapshot.wallet.loanBalanceRaw, 6)} USDC wallet balance`;
      case "withdraw-collateral": return `${formatUnits(snapshot.position.withdrawableCollateralRaw, 8)} cbBTC currently withdrawable`;
    }
  }, [operation, snapshot]);

  return (
    <main className={styles.page}>
      <section className={styles.experience} aria-labelledby="borrow-title">
        <nav className={styles.chrome} aria-label="Borrow navigation">
          <Link href="/dashboard">← Dashboard</Link>
          <Text as="span" textStyle="metadata" tone="muted">Home · Base</Text>
        </nav>
        <header className={styles.header}>
          <div>
            <Text as="p" textStyle="metadata" tone="muted" className={styles.kicker}>Borrow</Text>
            <Heading level={1} textStyle="page-title" id="borrow-title">USDC against cbBTC</Heading>
          </div>
          <Text as="span" textStyle="metadata" tone="muted">Base · Morpho Blue</Text>
        </header>

        <section className={styles.market} aria-labelledby="market-title">
          <div className={styles.sectionHeading}>
            <Heading level={2} textStyle="section-title" id="market-title">Supported market</Heading>
            <Text as="span" textStyle="metadata" tone="muted">One verified market</Text>
          </div>
          <dl className={styles.addresses}>
            <Fact label="Market ID" value={shortHash(BORROW_MARKET_ID)} title={BORROW_MARKET_ID} />
            <Fact
              label="Morpho"
              value={copyableAddress(MORPHO_BLUE_ADDRESS)}
            />
            <Fact
              label="Collateral"
              value={<>cbBTC · {copyableAddress(BORROW_COLLATERAL_TOKEN.address)}</>}
            />
            <Fact
              label="Loan"
              value={<>USDC · {copyableAddress(BORROW_LOAN_TOKEN.address)}</>}
            />
            <Fact
              label="Oracle"
              value={copyableAddress(BORROW_ORACLE_ADDRESS)}
            />
            <Fact label="LLTV" value={`${formatWadPercent(BORROW_LLTV_WAD.toString())}%`} />
          </dl>
        </section>

        {!sessionKey ? (
          <div className={styles.notice} role="status">
            <Text as="strong" textStyle="row-label">Sign in to view this wallet’s position</Text>
          </div>
        ) : null}
        {sessionKey && state.status === "loading" ? (
          <div className={styles.notice} role="status">
            <Text as="strong" textStyle="row-label">Loading current market state</Text>
            <Text as="span" textStyle="secondary" tone="muted">Oracle, liquidity, limits, and position are read from Base RPC.</Text>
          </div>
        ) : null}
        {sessionKey && state.status === "error" ? (
          <div className={styles.notice} role="alert">
            <Text as="strong" textStyle="row-label">Borrowing state unavailable</Text>
            <Text as="span" textStyle="secondary" tone="muted">Oracle, liquidity, rate, position, or limits could not be verified. Actions remain unavailable.</Text>
            <Button type="button" variant="secondary" onClick={() => void refresh()}>Retry</Button>
          </div>
        ) : null}

        {snapshot ? (
          <>
            <div className={styles.asOf}>
              <Text as="span" textStyle="metadata" tone="muted">RPC block {snapshot.source.blockNumber}</Text>
              <time dateTime={blockTime(snapshot.source.blockTimestamp)}>As of {formatTime(blockTime(snapshot.source.blockTimestamp))}</time>
            </div>
            <section className={styles.metrics} aria-labelledby="position-title">
              <div className={styles.sectionHeading}>
                <Heading level={2} textStyle="section-title" id="position-title">Wallet and position</Heading>
                <Button type="button" variant="secondary" onClick={() => void refresh()}>Refresh</Button>
              </div>
              {emptyWallet ? <Text as="p" textStyle="secondary" tone="muted" className={styles.empty}>This verified wallet has no cbBTC, USDC, or position in the supported market.</Text> : null}
              <dl className={styles.metricGrid}>
                <Metric label="cbBTC wallet" value={`${formatUnits(snapshot.wallet.collateralBalanceRaw, 8)} cbBTC`} />
                <Metric label="USDC wallet" value={`${formatUnits(snapshot.wallet.loanBalanceRaw, 6)} USDC`} />
                <Metric label="Collateral supplied" value={`${formatUnits(snapshot.position.collateralRaw, 8)} cbBTC`} />
                <Metric label="Current debt" value={`${formatUnits(snapshot.position.debtAssetsRaw, 6)} USDC`} note="Rounded up from Morpho borrow shares" />
                <Metric label="Current borrow capacity" value={`${formatUnits(snapshot.position.borrowCapacityAssetsRaw, 6)} USDC`} note="Lower of collateral limit and indexed liquidity" />
                <Metric label="Currently withdrawable" value={`${formatUnits(snapshot.position.withdrawableCollateralRaw, 8)} cbBTC`} note="At the pinned oracle price; not a promise" />
                <Metric label="Health factor" value={formatHealth(snapshot.position.healthFactorWad)} note={healthNote(snapshot.position.healthFactorWad)} />
                <Metric label="Liquidation price" value={snapshot.position.liquidationPriceRaw ? `${formatOracleUsd(snapshot.position.liquidationPriceRaw)} USDC / cbBTC` : "No debt"} />
                <Metric label="Oracle price" value={`${formatOracleUsd(snapshot.state.oraclePriceRaw)} USDC / cbBTC`} />
                <Metric label="Variable borrow APR" value={`${formatWadPercent(snapshot.state.borrowAprWad)}%`} note="Current per-second rate annualized; not fixed" />
                <Metric label="Indexed liquidity" value={`${formatUnits(snapshot.state.liquidityAssetsRaw, 6)} USDC`} />
                <Metric label="Market state updated" value={formatTime(blockTime(snapshot.state.lastUpdateTimestamp))} note="Debt is accrued locally to the pinned block" />
              </dl>
            </section>

            <form className={styles.form} onSubmit={submitPreview}>
              <div className={styles.sectionHeading}>
                <Heading level={2} textStyle="section-title">Preview action</Heading>
                <Text as="span" textStyle="metadata" tone="muted">Destination: verified wallet</Text>
              </div>
              <label>
                Action
                <select value={operation} onChange={(event) => { setOperation(event.target.value as BorrowOperation); setAmount(""); setPreview({ status: "idle" }); }}>
                  <option value="supply-collateral">Supply cbBTC collateral</option>
                  <option value="borrow">Borrow USDC</option>
                  <option value="repay">Repay USDC (partial)</option>
                  <option value="repay-all">Repay all USDC debt</option>
                  <option value="withdraw-collateral">Withdraw cbBTC collateral</option>
                </select>
              </label>
              <label>
                {operation === "repay-all" ? "Maximum debit" : "Amount"} ({actionAsset.symbol})
                <input
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  onChange={(event) => { setAmount(event.target.value); setPreview({ status: "idle" }); }}
                  placeholder={actionAsset.decimals === 8 ? "0.00000000" : "0.00"}
                />
              </label>
              <Text as="p" textStyle="metadata" tone="muted" className={styles.limit}>{selectedLimit}</Text>
              <Button type="submit" disabled={!amount.trim() || preview.status === "loading"}>
                {preview.status === "loading" ? "Checking RPC simulation…" : "Review current preview"}
              </Button>
            </form>
          </>
        ) : null}

        {preview.status === "error" ? (
          <div className={styles.notice} role="alert">
            <Text as="strong" textStyle="row-label">Preview unavailable</Text>
            <Text as="span" textStyle="secondary" tone="muted">{preview.message}</Text>
          </div>
        ) : null}
        {preview.status === "preview-only" ? (
          <section className={styles.previewOnly} aria-labelledby="preview-only-title">
            <Heading level={2} textStyle="section-title" id="preview-only-title">Read-only preview</Heading>
            <Text as="strong" textStyle="row-label">{preview.response.preview.title}</Text>
            <Text as="span" textStyle="row-value">{formatUnits(preview.response.preview.amount.amountBaseUnits, preview.response.preview.amount.decimals)} {preview.response.preview.amount.symbol}</Text>
            <ul>{preview.response.preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            <Text as="p" textStyle="secondary" tone="muted">{preview.response.preview.disabledReason}</Text>
          </section>
        ) : null}
      </section>

      {preview.status === "prepared" ? (
        <MoneyActionReview
          action={preview.action}
          onClose={() => setPreview({ status: "idle" })}
          onConfirmed={() => {
            setPreview({ status: "idle" });
            setAmount("");
            void refresh();
            onActionConfirmed?.();
          }}
        />
      ) : null}
    </main>
  );
}

function copyableAddress(value: string) {
  return (
    <CopyableValue
      value={value}
      display={formatAddress(value)}
      valueKind="address"
    />
  );
}

function Fact({ label, value, title }: { label: string; value: ReactNode; title?: string }) {
  return (
    <div>
      <dt><Text as="span" textStyle="metadata" tone="muted">{label}</Text></dt>
      <dd>
        <Text as="span" textStyle="row-value">
          {title ? <code title={title}>{value}</code> : value}
        </Text>
      </dd>
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt><Text as="span" textStyle="metadata" tone="muted">{label}</Text></dt>
      <dd>
        <Text as="span" textStyle="row-value">{value}</Text>
        {note ? <Text as="small" textStyle="metadata" tone="muted">{note}</Text> : null}
      </dd>
    </div>
  );
}

function parseSnapshot(value: unknown, expectedOwner: `0x${string}`): BorrowMarketSnapshot | null {
  if (!isRecord(value) || value.chainId !== 8453 || typeof value.walletAddress !== "string" || value.walletAddress.toLowerCase() !== expectedOwner.toLowerCase()) return null;
  if (!isRecord(value.market) || value.market.id !== BORROW_MARKET_ID || typeof value.market.morpho !== "string" || value.market.morpho.toLowerCase() !== MORPHO_BLUE_ADDRESS.toLowerCase()) return null;
  if (!isRecord(value.source) || typeof value.source.blockNumber !== "string" || typeof value.source.blockHash !== "string" || typeof value.source.blockTimestamp !== "string" || !/^0x[0-9a-f]{64}$/.test(value.source.blockHash)) return null;
  if (!isRecord(value.state) || !isRecord(value.wallet) || !isRecord(value.position)) return null;
  const decimalFields = [
    value.source.blockNumber, value.source.blockTimestamp,
    value.state.oraclePriceRaw, value.state.borrowRatePerSecondWad, value.state.borrowAprWad,
    value.state.totalSupplyAssetsRaw, value.state.totalBorrowAssetsRaw, value.state.totalBorrowSharesRaw,
    value.state.liquidityAssetsRaw, value.state.lastUpdateTimestamp,
    value.wallet.collateralBalanceRaw, value.wallet.loanBalanceRaw,
    value.wallet.collateralAllowanceRaw, value.wallet.loanAllowanceRaw,
    value.position.collateralRaw, value.position.borrowSharesRaw, value.position.debtAssetsRaw,
    value.position.borrowCapacityAssetsRaw, value.position.withdrawableCollateralRaw,
  ];
  if (decimalFields.some((field) => typeof field !== "string" || !/^\d+$/.test(field))) return null;
  if (value.position.healthFactorWad !== null && (typeof value.position.healthFactorWad !== "string" || !/^\d+$/.test(value.position.healthFactorWad))) return null;
  if (value.position.liquidationPriceRaw !== null && (typeof value.position.liquidationPriceRaw !== "string" || !/^\d+$/.test(value.position.liquidationPriceRaw))) return null;
  return value as BorrowMarketSnapshot;
}

function parsePreviewResponse(value: unknown, expectedOwner: `0x${string}`): BorrowPreviewResponse | null {
  if (!isRecord(value) || (value.status !== "prepared" && value.status !== "preview-only")) return null;
  const snapshot = parseSnapshot(value.snapshot, expectedOwner);
  if (!snapshot) return null;
  if (value.status === "prepared") {
    if (!isPreparedAction(value.action, expectedOwner)) return null;
    return { status: "prepared", action: value.action, snapshot };
  }
  if (!isRecord(value.preview) || value.preview.execution !== "disabled" || typeof value.preview.title !== "string" || typeof value.preview.disabledReason !== "string" || !isRecord(value.preview.amount) || typeof value.preview.amount.amountBaseUnits !== "string" || !/^\d+$/.test(value.preview.amount.amountBaseUnits) || !Array.isArray(value.preview.warnings) || value.preview.warnings.some((item) => typeof item !== "string")) return null;
  return value as BorrowPreviewResponse;
}

function isPreparedAction(value: unknown, expectedOwner: `0x${string}`): value is PreparedMoneyAction {
  if (!isRecord(value) || !isRecord(value.owner) || typeof value.owner.address !== "string" || value.owner.address.toLowerCase() !== expectedOwner.toLowerCase() || value.owner.chainId !== 8453) return false;
  return typeof value.id === "string" && typeof value.reviewHash === "string" && typeof value.title === "string" && typeof value.expiresAt === "string" && Array.isArray(value.calls) && value.calls.length > 0 && value.calls.every((call) => isRecord(call) && typeof call.to === "string" && /^0x[0-9a-fA-F]{40}$/.test(call.to) && typeof call.data === "string" && /^0x[0-9a-fA-F]+$/.test(call.data) && call.value === "0") && Array.isArray(value.amounts) && Array.isArray(value.warnings);
}

function formatUnits(raw: string, decimals: number) {
  const value = BigInt(raw);
  const scale = BigInt("10") ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function formatWadPercent(raw: string) {
  const basisPoints = (BigInt(raw) * BigInt("10000")) / BigInt("1000000000000000000");
  return `${basisPoints / BigInt("100")}.${(basisPoints % BigInt("100")).toString().padStart(2, "0")}`;
}

function formatOracleUsd(raw: string) {
  const cents = (BigInt(raw) * (BigInt("10") ** BigInt("8")) * BigInt("100")) /
    ((BigInt("10") ** BigInt("6")) * (BigInt("10") ** BigInt("36")));
  const whole = (cents / BigInt("100")).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${whole}.${(cents % BigInt("100")).toString().padStart(2, "0")}`;
}

function formatHealth(raw: string | null) {
  if (raw === null) return "No debt";
  const hundredths = (BigInt(raw) * BigInt("100")) / BigInt("1000000000000000000");
  return `${hundredths / BigInt("100")}.${(hundredths % BigInt("100")).toString().padStart(2, "0")}`;
}

function healthNote(raw: string | null) {
  if (raw === null) return "No active liquidation threshold";
  const health = BigInt(raw);
  if (health < BigInt("1000000000000000000")) return "At or below the indexed liquidation threshold";
  if (health < BigInt("1100000000000000000")) return "Very close to liquidation";
  if (health < BigInt("1250000000000000000")) return "Limited liquidation buffer";
  return "Current indexed ratio; not a safety guarantee";
}

function blockTime(seconds: string) {
  return new Date(Number(seconds) * 1_000).toISOString();
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value));
}

function shortHash(value: string) { return `${value.slice(0, 10)}…${value.slice(-8)}`; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isAbortError(error: unknown) { return error instanceof DOMException && error.name === "AbortError"; }
function readableResourceError(error: unknown) {
  if (error instanceof Error && error.message && error.message !== "Authenticated resource is unavailable.") return error.message;
  return "The current limit or RPC simulation could not be verified. Refresh and try again.";
}
