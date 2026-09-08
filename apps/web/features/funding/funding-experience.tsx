"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccountWallet, type AccountWalletClient } from "@/features/account/cdp-client";
import { parseActivityPage } from "@/features/activity/parse";
import type { ActivityTransfer } from "@/features/activity/types";
import { formatTokenAmount } from "@/features/formatting";
import { parsePortfolioSnapshot, type PortfolioSnapshot } from "@/features/portfolio";
import { formatTransferAmount } from "@/features/transfers/transfer-helpers";
import {
  FundingRequestError,
  readFundingAttempt,
  requestHostedOnrampSession,
  writeFundingAttempt,
  type FundingAttempt,
} from "./funding-client";
import { FUNDING_ASSETS } from "./types";
import styles from "./funding.module.css";

export type FundingExperienceProps = {
  returnedFromCoinbase?: boolean;
};

type FundingWallet = Pick<
  AccountWalletClient,
  | "ownerKey"
  | "status"
  | "session"
  | "fetchPortfolio"
  | "fetchActivity"
  | "fetchAccountResource"
>;

type CheckResult = {
  message: string;
  transactionHash?: `0x${string}`;
};

export function FundingExperience(props: FundingExperienceProps) {
  const wallet = useAccountWallet();
  return (
    <FundingExperienceForWallet
      {...props}
      wallet={wallet}
      navigateToHostedOnramp={(url) => window.location.assign(url)}
    />
  );
}

type FundingExperienceForWalletProps = FundingExperienceProps & {
  wallet: FundingWallet;
  navigateToHostedOnramp: (url: string) => void;
};

export function FundingExperienceForWallet(
  props: FundingExperienceForWalletProps,
) {
  return (
    <FundingExperienceBoundary
      key={fundingBoundary(props.wallet) ?? "signed-out"}
      {...props}
    />
  );
}

function FundingExperienceBoundary({
  wallet,
  navigateToHostedOnramp,
  returnedFromCoinbase = false,
}: FundingExperienceForWalletProps) {
  const boundary = fundingBoundary(wallet);
  const session = wallet.status === "verified" ? wallet.session : null;
  const address = session?.smartAccount?.address ?? null;
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | null>(null);
  const [loadingBalances, setLoadingBalances] = useState(true);
  const [checking, setChecking] = useState(false);
  const [openingOnramp, setOpeningOnramp] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [onrampError, setOnrampError] = useState<string | null>(null);
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const latestSnapshotRef = useRef<PortfolioSnapshot | null>(null);
  const checkedReturnBoundaryRef = useRef<string | null>(null);
  const activeRef = useRef(false);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  const loadSnapshot = useCallback(async (): Promise<PortfolioSnapshot> => {
    if (!session?.smartAccount || !boundary) throw new Error("unavailable");
    const value = await wallet.fetchPortfolio();
    return parsePortfolioSnapshot(value, {
      subject: session.user.subject,
      smartAccountAddress: session.smartAccount.address,
      chainId: session.smartAccount.chainId,
    });
  }, [boundary, session, wallet]);

  const checkReceived = useCallback(
    async (attempt?: FundingAttempt | null) => {
      if (!session?.smartAccount || !boundary) return;
      setChecking(true);
      setBalanceError(null);
      const previous = latestSnapshotRef.current;
      try {
        const current = await loadSnapshot();
        let receipt: ActivityTransfer | null = null;
        const startedAt = attempt?.startedAt;
        if (startedAt) {
          const to = new Date().toISOString();
          try {
            const page = parseActivityPage(
              await wallet.fetchActivity(new URLSearchParams({ to }).toString()),
              session,
              to,
            );
            receipt =
              page.transfers.find(
                (transfer) =>
                  transfer.assetId === "usdc" &&
                  transfer.direction === "incoming" &&
                  BigInt(transfer.amountBaseUnits) > 0 &&
                  transfer.blockTimestamp >= startedAt,
              ) ?? null;
          } catch {
            // Balance verification remains available when CDP SQL receipt history is not configured.
          }
        }

        const baselineUsdc = attempt?.baselineUsdcBaseUnits ?? assetBalance(previous, "usdc");
        const baselineEth = assetBalance(previous, "eth");
        const currentUsdc = assetBalance(current, "usdc") ?? "0";
        const currentEth = assetBalance(current, "eth") ?? "0";
        const usdcDelta = positiveDifference(currentUsdc, baselineUsdc);
        const ethDelta = positiveDifference(currentEth, baselineEth);

        if (receipt) {
          setCheckResult({
            message: `An incoming ${formatTransferAmount(receipt.amountBaseUnits, 6)} USDC transfer has a Base transaction receipt. This proves the transfer reached this address, not that a Coinbase payment completed.`,
            transactionHash: receipt.transactionHash,
          });
        } else if (usdcDelta) {
          setCheckResult({
            message: `The verified Base USDC balance increased by ${formatTransferAmount(usdcDelta, 6)} USDC. No linked Coinbase payment status is being claimed.`,
          });
        } else if (ethDelta) {
          setCheckResult({
            message: `The verified Base ETH balance increased by ${formatTransferAmount(ethDelta, 18)} ETH.`,
          });
        } else {
          setCheckResult({
            message: "No increase in the supported Base balances was found. A Coinbase return or copied address does not confirm a deposit.",
          });
        }
        latestSnapshotRef.current = current;
        setSnapshot(current);
      } catch {
        setBalanceError("Home could not refresh this verified Base account. No deposit is being confirmed.");
      } finally {
        setChecking(false);
      }
    },
    [boundary, loadSnapshot, session, wallet],
  );

  useEffect(() => {
    if (!boundary || !session?.smartAccount) return;

    let active = true;
    void loadSnapshot()
      .then((next) => {
        if (!active) return;
        latestSnapshotRef.current = next;
        setSnapshot(next);
      })
      .catch(() => {
        if (active) setBalanceError("Supported Base balances are temporarily unavailable.");
      })
      .finally(() => {
        if (active) setLoadingBalances(false);
      });

    return () => {
      active = false;
    };
  }, [boundary, loadSnapshot, session]);

  useEffect(() => {
    if (
      !returnedFromCoinbase ||
      !boundary ||
      !session?.smartAccount ||
      checkedReturnBoundaryRef.current === boundary
    ) {
      return;
    }
    checkedReturnBoundaryRef.current = boundary;
    const attempt = readFundingAttempt(window.sessionStorage, {
      accountProvider: session.accountProvider,
      address: session.smartAccount.address,
    });
    void checkReceived(attempt);
  }, [boundary, checkReceived, returnedFromCoinbase, session]);

  async function copyAddress() {
    if (!address || !navigator.clipboard?.writeText) {
      setCopyStatus("error");
      return;
    }
    try {
      await navigator.clipboard.writeText(address);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  }

  async function openCoinbase() {
    if (!session?.smartAccount || !boundary || openingOnramp) return;
    setOpeningOnramp(true);
    setOnrampError(null);
    try {
      let current = latestSnapshotRef.current;
      if (!current) {
        current = await loadSnapshot().catch(() => null);
      }
      const attempt: FundingAttempt = {
        version: 1,
        accountProvider: session.accountProvider,
        address: session.smartAccount.address.toLowerCase() as `0x${string}`,
        startedAt: new Date().toISOString(),
        baselineUsdcBaseUnits: assetBalance(current, "usdc"),
      };
      const hosted = await requestHostedOnrampSession({
        fetchAccountResource: wallet.fetchAccountResource,
      });
      if (!activeRef.current) return;
      writeFundingAttempt(window.sessionStorage, attempt);
      navigateToHostedOnramp(hosted.url);
    } catch (caught) {
      setOnrampError(messageForOnrampError(caught));
      setOpeningOnramp(false);
    }
  }

  if (!boundary || !session?.smartAccount || !address) {
    return (
      <main className={styles.page}>
        <div className={styles.shell}>
          <header className={styles.header}>
            <Link className={styles.back} href="/">← Home</Link>
          </header>
          <section className={styles.card}>
            <h1 className={styles.title}>Add money</h1>
            <p className={styles.lead}>Sign in and verify a Base account before showing a funding address.</p>
            <div className={styles.actions}>
              <Link className={styles.signIn} href="/?account=signin">
                Sign in
              </Link>
              <Link className={styles.home} href="/">
                Home
              </Link>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link className={styles.back} href="/dashboard">← Dashboard</Link>
          <a
            className={styles.explorer}
            href={`https://basescan.org/address/${address}`}
            target="_blank"
            rel="noreferrer"
          >
            View account on BaseScan
          </a>
        </header>

        {returnedFromCoinbase ? (
          <p className={styles.returnNotice} role="status">
            You returned from Coinbase. Returning does not confirm a purchase or deposit. Home checks only this verified Base account and available onchain receipts.
          </p>
        ) : null}

        <section className={styles.card}>
          <h1 className={styles.title}>Add money</h1>
          <p className={styles.lead}>Send a supported asset from a crypto wallet to this verified Base account.</p>
          <p className={styles.network}>Base network · chain 8453</p>

          <div className={styles.assetGrid}>
            <AssetCard
              name="USD Coin"
              symbol="USDC"
              balance={displayBalance(snapshot, "usdc", loadingBalances)}
              identity={`ERC-20 · 6 decimals · ${FUNDING_ASSETS.usdc.tokenAddress}`}
            />
            <AssetCard
              name="Ether"
              symbol="ETH"
              balance={displayBalance(snapshot, "eth", loadingBalances)}
              identity="Native ETH · 18 decimals · no token contract"
            />
          </div>

          <p className={styles.addressLabel}>Verified smart-account address</p>
          <output className={styles.address}>{address}</output>
          <div className={styles.buttonRow}>
            <button className={styles.primary} type="button" onClick={() => void copyAddress()}>
              {copyStatus === "copied" ? "Copied" : "Copy address"}
            </button>
            <button
              className={styles.secondary}
              type="button"
              disabled={checking}
              onClick={() => void checkReceived(null)}
            >
              {checking ? "Checking…" : "Check received"}
            </button>
          </div>
          <p className={copyStatus === "error" ? styles.error : styles.help} role={copyStatus === "error" ? "alert" : "status"}>
            {copyStatus === "copied"
              ? "Address copied. Copying does not confirm a transfer."
              : copyStatus === "error"
                ? "Clipboard access failed. Select and copy the address manually."
                : "Send only canonical USDC or native ETH on Base. Assets or networks not listed here may be lost."}
          </p>
          {balanceError ? <p className={styles.error} role="alert">{balanceError}</p> : null}
          {checkResult ? <CheckResultView result={checkResult} /> : null}
        </section>

        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>Buy USDC with Coinbase</h2>
          <p className={styles.lead}>Continue to Coinbase&apos;s hosted Onramp. Home does not collect fiat payment details.</p>
          <button
            className={styles.primary}
            type="button"
            disabled={openingOnramp}
            onClick={() => void openCoinbase()}
          >
            {openingOnramp ? "Opening Coinbase…" : "Continue to Coinbase"}
          </button>
          <p className={styles.help}>Availability, payment methods, limits, and fees are determined by Coinbase for the user and region. Home requests canonical USDC on Base to the verified address above.</p>
          {onrampError ? <p className={styles.error} role="alert">{onrampError}</p> : null}
        </section>
      </div>
    </main>
  );
}

function AssetCard({
  name,
  symbol,
  balance,
  identity,
}: {
  name: string;
  symbol: string;
  balance: string;
  identity: string;
}) {
  return (
    <div className={styles.asset}>
      <div className={styles.assetHead}>
        <span className={styles.assetName}>{name} ({symbol})</span>
        <span className={styles.assetBalance}>{balance}</span>
      </div>
      <p className={styles.assetIdentity}>{identity}</p>
    </div>
  );
}

function CheckResultView({ result }: { result: CheckResult }) {
  return (
    <div className={styles.receipt} role="status">
      <p>{result.message}</p>
      {result.transactionHash ? (
        <a
          className={styles.explorer}
          href={`https://basescan.org/tx/${result.transactionHash}`}
          target="_blank"
          rel="noreferrer"
        >
          View incoming transfer receipt on BaseScan
        </a>
      ) : null}
    </div>
  );
}

function fundingBoundary(wallet: FundingWallet): string | null {
  const session = wallet.status === "verified" ? wallet.session : null;
  return wallet.ownerKey && session?.smartAccount
    ? `${wallet.ownerKey}\u0000${session.user.subject}\u0000${session.smartAccount.address}\u0000${session.accountProvider}`
    : null;
}

function assetBalance(
  snapshot: PortfolioSnapshot | null,
  assetId: "usdc" | "eth",
): string | null {
  return snapshot?.assets.find((asset) => asset.id === assetId)?.balanceBaseUnits ?? null;
}

function positiveDifference(current: string, baseline: string | null): string | null {
  if (baseline === null) return null;
  const difference = BigInt(current) - BigInt(baseline);
  return difference > 0 ? difference.toString(10) : null;
}

function displayBalance(
  snapshot: PortfolioSnapshot | null,
  assetId: "usdc" | "eth",
  loading: boolean,
): string {
  if (!snapshot) return loading ? "Checking…" : "Unavailable";
  const asset = snapshot.assets.find((candidate) => candidate.id === assetId);
  return asset ? `${formatTokenAmount(asset.balanceBaseUnits, asset.decimals)} ${asset.symbol}` : "Unavailable";
}

function messageForOnrampError(error: unknown): string {
  if (error instanceof FundingRequestError) {
    if (error.code === "unauthenticated") {
      return "Your verified session changed before Coinbase opened. Sign in again; no hosted session was used.";
    }
    if (error.code === "not-configured") {
      return "Coinbase Onramp is unavailable because this deployment does not have its existing CDP server credentials configured. Crypto wallet funding remains available above.";
    }
  }
  return "Coinbase hosted funding is unavailable. The existing CDP project may need Onramp access or this Home return origin allowlisted. Crypto wallet funding remains available above.";
}
