"use client";

import type { useMoneyActionOutcome } from "@/client/actions/money-action-outcome";
import { ResultHeader } from "@/components/ui/result-header";
import { StatusStep, StatusSteps } from "@/components/ui/status-step";
import { formatPresentationDate } from "@/shared/formatting";
import { MoneyModalFooter } from "./money-modal";

type MoneyResultOutcome = ReturnType<typeof useMoneyActionOutcome>["outcome"];
type MoneyResultKind = "send" | "cash-out" | "cash-out-withdraw" | "savings-deposit" | "savings-withdraw" |
  "supply-collateral" | "borrow" | "supply-and-borrow" | "repay" | "repay-all" | "withdraw-collateral" | "close-position";
type MoneyResultCopyInput = {
  kind: MoneyResultKind;
  outcome: MoneyResultOutcome;
  amount?: string;
  provider?: string;
};

export function moneyResultCopy({ kind, outcome, amount, provider }: MoneyResultCopyInput): { title: string; description?: string } {
  const a = amount ?? "the amount";
  const titles: Record<MoneyResultKind, [string, string, string]> = {
    send: [`${a} sent`, `${a} on its way`, `${a} wasn't sent`],
    "cash-out": [`${a} sent to cash out`, `Cashing out ${a}`, "Cash-out didn't go through"],
    "cash-out-withdraw": [`${a} returned to your account`, `Returning ${a} to your account`, "Withdrawal didn't go through"],
    "savings-deposit": [`Deposited ${a} to Save`, `Depositing ${a} to Save`, "Deposit didn't go through"],
    "savings-withdraw": [`Withdrew ${a} from Save`, `Withdrawing ${a} from Save`, "Withdrawal didn't go through"],
    "supply-collateral": [`Added ${a} as collateral`, `Adding ${a} as collateral`, "Adding collateral didn't go through"],
    borrow: [`Borrowed ${a}`, `Borrowing ${a}`, "Borrow didn't go through"],
    "supply-and-borrow": [`Supplied collateral and borrowed ${a}`, `Supplying collateral and borrowing ${a}`, "Borrow didn't go through"],
    repay: [`Repaid ${a}`, `Repaying ${a}`, "Repayment didn't go through"],
    "repay-all": ["Repaid all Borrow debt", "Repaying all Borrow debt", "Repayment didn't go through"],
    "withdraw-collateral": [`Withdrew ${a} collateral`, `Withdrawing ${a} collateral`, "Collateral withdrawal didn't go through"],
    "close-position": ["Closed Borrow position", "Closing Borrow position", "Closing Borrow position didn't go through"],
  };
  if (outcome === "unknown") return {
    title: kind === "close-position" ? "We can't confirm closing your Borrow position" : kind === "repay-all"
      ? "We can't confirm repaying all Borrow debt" : `We can't confirm ${a}`,
    description: kind === "send" || kind === "cash-out"
      ? "It may have left your account. Check Activity before sending again."
      : "It may have gone through. Check Activity before trying again.",
  };
  const isBorrow = !["send", "cash-out", "cash-out-withdraw", "savings-deposit", "savings-withdraw"].includes(kind);
  if (outcome === "failed") return {
    title: titles[kind][2],
    description: isBorrow ? "Your Borrow position didn't change." : kind === "savings-withdraw"
      ? `Your ${a} is still in Save.` : kind === "cash-out-withdraw"
      ? `Your ${a} is still in your ${provider ?? "provider"} cash-out.` : `Your ${a} is still in your account.`,
  };
  if (outcome === "pending") return { title: titles[kind][1], description: "We'll update Activity when it's confirmed." };
  return {
    title: titles[kind][0],
    ...(kind === "cash-out" ? { description: `${provider ?? "Your provider"} sends the payout next. Track it in Activity.` } : {}),
  };
}

export function MoneyResult({ kind, outcome, amount, provider, submittedAt }: MoneyResultCopyInput & { submittedAt?: string }) {
  const { title, description } = moneyResultCopy({ kind, outcome, amount, provider });
  const parsedTime = submittedAt ? Date.parse(submittedAt) : NaN;
  const time = Number.isFinite(parsedTime) ? formatPresentationDate(parsedTime, { style: "chart-time" }) : undefined;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 py-6">
      <ResultHeader outcome={outcome} title={title} description={description} />
      {outcome === "pending" ? <div className="w-full max-w-sm"><StatusSteps>
        <StatusStep status="complete" title="Submitted" time={time} />
        <StatusStep status="current" title="Confirming on Base" />
      </StatusSteps></div> : null}
    </div>
  );
}

export function MoneyResultFooter({ outcome, onDone, onTryAgain, onViewActivity }: {
  outcome: MoneyResultOutcome;
  onDone: () => void;
  onTryAgain: () => void;
  onViewActivity: () => void;
}) {
  if (outcome === "success") return <MoneyModalFooter primaryAutoFocus primaryLabel="Done" onPrimary={onDone} />;
  if (outcome === "failed") return <MoneyModalFooter primaryAutoFocus primaryLabel="Try again" onPrimary={onTryAgain} secondaryLabel="Done" onSecondary={onDone} />;
  if (outcome === "pending") return <MoneyModalFooter primaryAutoFocus primaryLabel="Done" onPrimary={onDone} secondaryLabel="View in Activity" onSecondary={onViewActivity} />;
  return <MoneyModalFooter primaryAutoFocus primaryLabel="View in Activity" onPrimary={onViewActivity} secondaryLabel="Done" onSecondary={onDone} />;
}
