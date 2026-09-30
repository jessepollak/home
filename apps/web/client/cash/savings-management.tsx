"use client";

import { useCallback, type RefObject, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { MoneyModalActions, MoneyModalBody, MoneyModalHeader, moneySheetIntent } from "@/client/money-modal";
import { getSavingsRateState } from "@/client/savings/portfolio-summary";
import { ManagementFacts } from "@/components/management-facts";
import { MoneyTicker } from "@/components/money-ticker";
import { Button } from "@/components/ui/button";
import type { RegionId } from "@/config/regions";
import type { BalancesSnapshot } from "@/shared/balances/types";
import { formatPresentationDate, formatPresentationPercentage, formatUsdStablecoinAmount } from "@/shared/formatting";
import type { MorphoVaultCandidate, MorphoVaultsResult } from "@/shared/savings/types";
import { savingsWithdrawTargets } from "./savings-withdraw-targets";

export type SavingsManagementAction = { enabled: boolean; reason: string | null };

export type SavingsManagement = {
  address: string;
  name: string;
  savedBaseUnits: string | null;
  unreadable: boolean;
  absent: boolean;
  rateLabel: string;
  depositCandidate: MorphoVaultCandidate | null;
  withdrawCandidate: MorphoVaultCandidate | null;
  deposit: SavingsManagementAction;
  withdraw: SavingsManagementAction;
  facts: Array<[string, string]>;
  details: Array<[string, string]>;
  liquidityNote: string | null;
};

export function savingsRateLabel(candidate: MorphoVaultCandidate | null, metadata: MorphoVaultsResult | null, nowMs: number, regionId: RegionId): string {
  if (!candidate || !metadata) return "Rate unavailable";
  const rate = getSavingsRateState(candidate, {
    metadataFetchedAt: metadata.source.fetchedAt,
    metadataStale: metadata.stale,
    nowMs,
  });
  return rate.status !== "unavailable" ? `${formatPresentationPercentage(rate.value, regionId)} APY` : "Rate unavailable";
}

export function formatWadPercent(value: string): string {
  const wad = BigInt(value);
  const scaled = wad * BigInt(100_000_000) / BigInt("1000000000000000000");
  const whole = scaled / BigInt(1_000_000);
  const fraction = (scaled % BigInt(1_000_000))
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}%` : `${whole}%`;
}

export function savingsManagement({ address, snapshot, metadata, nowMs, regionId, actionsAvailable, usdcBaseUnits, usdcUnavailable }: {
  address: string;
  snapshot: BalancesSnapshot | null;
  metadata: MorphoVaultsResult | null;
  nowMs: number;
  regionId: RegionId;
  actionsAvailable: boolean;
  usdcBaseUnits: string | null;
  usdcUnavailable: boolean;
}): SavingsManagement {
  const normalized = address.toLowerCase();
  const holding = snapshot?.holdings.find((entry) => entry.kind === "vault-share" && entry.contractAddress?.toLowerCase() === normalized);
  const absent = holding === undefined && snapshot?.coverage.registry === "complete";
  const savedBaseUnits = absent ? "0" : holding?.underlyingBalance?.status === "ready" ? holding.underlyingBalance.baseUnits : null;
  const unreadable = !absent && holding !== undefined && savedBaseUnits === null;
  const depositCandidate = metadata?.candidates.find((candidate) => candidate.vaultAddress.toLowerCase() === normalized) ?? null;
  const withdrawCandidate = savingsWithdrawTargets(snapshot, metadata).find((target) => target.candidate.vaultAddress.toLowerCase() === normalized)?.candidate ?? null;
  const candidate = depositCandidate ?? withdrawCandidate;
  const depositReason = !actionsAvailable ? "Verify a Base smart account to deposit."
    : usdcUnavailable ? "Couldn't check your Cash balance."
      : metadata === null ? "Rates are unavailable. Try again."
        : depositCandidate === null ? "Deposits are paused for this vault." : null;
  const withdrawReason = !actionsAvailable ? "Verify a Base smart account to withdraw."
    : savedBaseUnits === null ? "Couldn't check this balance."
      : BigInt(savedBaseUnits) === BigInt(0) ? "Nothing saved to withdraw."
        : withdrawCandidate === null ? "Withdrawals are unavailable for this vault." : null;
  return {
    address,
    name: depositCandidate?.name ?? holding?.name ?? address,
    savedBaseUnits,
    absent,
    unreadable,
    rateLabel: savingsRateLabel(depositCandidate, metadata, nowMs, regionId),
    depositCandidate,
    withdrawCandidate,
    deposit: { enabled: depositReason === null, reason: depositReason },
    withdraw: { enabled: withdrawReason === null, reason: withdrawReason },
    facts: usdcBaseUnits !== null && BigInt(usdcBaseUnits) > BigInt(0) ? [["In wallet", formatUsdStablecoinAmount(usdcBaseUnits)]] : [],
    details: [
      ["Vault", `${normalized.slice(0, 6)}…${normalized.slice(-4)}`],
      ...(candidate?.chainId === 8453 ? [["Network", "Base"] as [string, string]] : []),
      ...(typeof candidate?.feeRate === "number" ? [["Performance fee", formatWadPercent(BigInt(Math.round(candidate.feeRate * 1e18)).toString())] as [string, string]] : []),
      ...(candidate?.stateAsOf ? [["Rate checked", formatPresentationDate(candidate.stateAsOf, { style: "date-time-zone" })] as [string, string]] : []),
    ],
    liquidityNote: candidate?.liquidityRaw === "0" ? "No liquidity available to withdraw right now." : null,
  };
}

export function SavingsManagementSheet({ management, titleId, detailsId, detailsOpen, onDetailsOpenChange, initialFocusRef, restoreAction, onDeposit, onWithdraw, onActionIntent }: {
  management: SavingsManagement;
  titleId: string;
  detailsId: string;
  detailsOpen: boolean;
  onDetailsOpenChange: (open: boolean) => void;
  initialFocusRef: RefObject<HTMLElement | null>;
  restoreAction: "deposit" | "withdraw" | null;
  onDeposit: () => void;
  onWithdraw: () => void;
  onActionIntent?: () => void;
}): ReactNode {
  const reason = management.deposit.reason ?? management.withdraw.reason;
  const restoreActionEnabled = restoreAction === "deposit" ? management.deposit.enabled : restoreAction === "withdraw" ? management.withdraw.enabled : false;
  const actionIntent = onActionIntent ? moneySheetIntent(onActionIntent) : {};
  const attachInitialFocus = useCallback((node: HTMLElement | null) => {
    initialFocusRef.current = node;
  }, [initialFocusRef]);
  return <>
    <MoneyModalHeader title={management.name} titleId={titleId} closeLabel={`Close ${management.name} details`} />
    <MoneyModalBody hasFooter className="gap-4 pt-4">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">Saved</p>
        <p ref={restoreActionEnabled ? undefined : attachInitialFocus} tabIndex={-1} className="text-3xl font-semibold tabular-nums">
          {management.unreadable || management.savedBaseUnits === null ? <><span aria-hidden="true">—</span><span className="sr-only">Unavailable</span></> :
            <MoneyTicker animated={false} align="start" className="max-w-full" reserveDigits={false} value={formatUsdStablecoinAmount(management.savedBaseUnits)} />}
        </p>
        <p className="text-sm text-muted-foreground">{management.rateLabel}{management.rateLabel === "Rate unavailable" ? "" : " · variable"}</p>
      </div>
      {management.facts.length ? <ManagementFacts rows={management.facts} /> : null}
      {management.liquidityNote ? <p className="text-sm text-muted-foreground">{management.liquidityNote}</p> : null}
      {management.details.length ? <div><Button variant="ghost" className="min-h-11 justify-start ps-0" aria-expanded={detailsOpen} aria-controls={detailsId} onClick={() => onDetailsOpenChange(!detailsOpen)}>
        Details<ChevronDown className={`size-4 transition-transform duration-150 motion-reduce:transition-none ${detailsOpen ? "rotate-180" : ""}`} />
      </Button><div id={detailsId} hidden={!detailsOpen}><ManagementFacts rows={management.details} /></div></div> : null}
    </MoneyModalBody>
    <MoneyModalActions>
      {reason ? <p className="text-sm text-muted-foreground">{reason}</p> : null}
      <div className="grid grid-cols-2 gap-2">
        <Button className="h-auto min-h-11 w-full whitespace-normal" variant="default" ref={restoreActionEnabled && restoreAction === "deposit" ? attachInitialFocus : undefined} disabled={!management.deposit.enabled} {...actionIntent} onClick={onDeposit}>Deposit more</Button>
        <Button className="h-auto min-h-11 w-full whitespace-normal" variant="secondary" ref={restoreActionEnabled && restoreAction === "withdraw" ? attachInitialFocus : undefined} disabled={!management.withdraw.enabled} {...actionIntent} onClick={onWithdraw}>Withdraw</Button>
      </div>
    </MoneyModalActions>
  </>;
}
