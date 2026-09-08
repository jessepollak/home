"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  useAccountWallet,
  type AccountResourceOptions,
} from "@/features/account/cdp-client";
import type { VerifiedAccountSession } from "@/features/account/session-types";
import { formatPercentage } from "@/features/formatting";
import { MoneyActionReview } from "@/features/money-actions/review";
import type {
  OperationResult,
  PreparedMoneyAction,
} from "@/features/money-actions/types";
import { BASE_USDC_DECIMALS } from "@/server/morpho/config";
import type { MorphoVaultCandidate } from "@/server/morpho/types";
import styles from "./savings-actions.module.css";

type SavingsActionsProps = {
  session: VerifiedAccountSession;
  candidates: MorphoVaultCandidate[];
  fetchAccountResource: SavingsActionTransport;
  onConfirmed?: (result: OperationResult) => void | Promise<void>;
};

type AuthenticatedSavingsActionsProps = Omit<
  SavingsActionsProps,
  "fetchAccountResource"
>;

type SavingsActionMode = "deposit" | "withdraw";

export type SavingsActionTransport = (
  path: string,
  options?: AccountResourceOptions,
) => Promise<unknown>;

export function AuthenticatedSavingsActions(
  props: AuthenticatedSavingsActionsProps,
) {
  const account = useAccountWallet();
  return <SavingsActions {...props} fetchAccountResource={account.fetchAccountResource} />;
}

export function SavingsActions({
  session,
  candidates,
  onConfirmed,
  fetchAccountResource,
}: SavingsActionsProps) {
  const [vaultAddress, setVaultAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<SavingsActionMode>("deposit");
  const [preparing, setPreparing] = useState(false);
  const [prepared, setPrepared] = useState<PreparedMoneyAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receiptStatus, setReceiptStatus] = useState<string | null>(null);
  const selected = useMemo(
    () => candidates.find((candidate) => candidate.vaultAddress.toLowerCase() === vaultAddress.toLowerCase()) ?? null,
    [candidates, vaultAddress],
  );
  const available = Boolean(session.smartAccount && selected);

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preparing) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const requestedMode = submitter instanceof HTMLButtonElement && submitter.value === "withdraw"
      ? "withdraw"
      : "deposit";
    setMode(requestedMode);
    setError(null);
    setReceiptStatus(null);
    setPreparing(true);
    try {
      if (!session.smartAccount || !selected) {
        throw new SavingsActionClientError("Select a supported vault first.");
      }
      const amountBaseUnits = parseUsdcAmount(amount);
      const value = await fetchAccountResource("/api/savings/actions", {
        method: "POST",
        body: {
          kind: requestedMode,
          vaultAddress: selected.vaultAddress,
          amountBaseUnits,
        },
      });
      const action = parsePreparedAction(value, session, requestedMode);
      setPrepared(action);
    } catch (caught) {
      setError(messageForPrepareError(caught));
    } finally {
      setPreparing(false);
    }
  }

  async function confirmed(result: OperationResult) {
    setReceiptStatus("Receipt confirmed. Refreshing savings, portfolio, and activity data…");
    try {
      await onConfirmed?.(result);
      setReceiptStatus("Receipt confirmed. Current account data was refreshed.");
    } catch {
      setReceiptStatus("Receipt confirmed. Some account data could not be refreshed yet.");
    }
  }

  return (
    <section className={styles.actions} aria-labelledby="savings-actions-title">
      <div className={styles.heading}>
        <div>
          <p>Prepare an action</p>
          <h3 id="savings-actions-title">Deposit or withdraw USDC</h3>
        </div>
        <span>User-executed on Base</span>
      </div>

      <form className={styles.form} onSubmit={prepare}>
        <label htmlFor="savings-vault">Vault</label>
        <select
          id="savings-vault"
          value={vaultAddress}
          onChange={(event) => {
            setVaultAddress(event.target.value);
            setPrepared(null);
            setError(null);
          }}
        >
          <option value="">Select a configured vault</option>
          {candidates.map((candidate) => (
            <option key={candidate.vaultAddress} value={candidate.vaultAddress}>
              {candidate.name}
            </option>
          ))}
        </select>

        {selected ? (
          <dl className={styles.vaultFacts}>
            <div>
              <dt>Variable net APY</dt>
              <dd>{formatPercentage(selected.netApy)}</dd>
            </div>
            <div>
              <dt>Vault fee</dt>
              <dd>{formatPercentage(selected.feeRate)}</dd>
            </div>
            <div>
              <dt>Underlying</dt>
              <dd>Canonical USDC on Base</dd>
            </div>
          </dl>
        ) : null}

        <label htmlFor="savings-amount">USDC amount</label>
        <input
          id="savings-amount"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
            setPrepared(null);
            setError(null);
          }}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          required
        />
        <p className={styles.help}>
          Exact balances, allowance, current limits, and ERC-4626 preview are read from one confirmed Base block before review.
        </p>

        <div className={styles.buttons}>
          <button
            type="submit"
            name="savings-action"
            value="deposit"
            disabled={!available || preparing}
          >
            {preparing && mode === "deposit" ? "Preparing…" : "Review deposit"}
          </button>
          <button
            type="submit"
            name="savings-action"
            value="withdraw"
            disabled={!available || preparing}
          >
            {preparing && mode === "withdraw" ? "Preparing…" : "Review withdrawal"}
          </button>
        </div>
      </form>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {receiptStatus ? <p className={styles.status} role="status">{receiptStatus}</p> : null}

      {prepared ? (
        <MoneyActionReview
          action={prepared}
          onClose={() => setPrepared(null)}
          onConfirmed={confirmed}
        />
      ) : null}
    </section>
  );
}

function parseUsdcAmount(value: string): string {
  const match = /^([0-9]+)(?:\.([0-9]+))?$/.exec(value.trim());
  if (!match) {
    throw new SavingsActionClientError("Enter a positive USDC amount using decimal digits only.");
  }
  const fraction = match[2] ?? "";
  if (fraction.length > BASE_USDC_DECIMALS) {
    throw new SavingsActionClientError("USDC supports at most 6 decimal places.");
  }
  const whole = match[1].replace(/^0+(?=\d)/, "");
  const raw = BigInt(`${whole}${fraction.padEnd(BASE_USDC_DECIMALS, "0")}`);
  if (raw <= BigInt(0)) {
    throw new SavingsActionClientError("Enter a positive USDC amount.");
  }
  return raw.toString(10);
}

function parsePreparedAction(
  value: unknown,
  session: VerifiedAccountSession,
  mode: SavingsActionMode,
): PreparedMoneyAction {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.reviewHash !== "string" ||
    typeof value.title !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.expiresAt !== "string" ||
    !Array.isArray(value.calls) ||
    !Array.isArray(value.amounts) ||
    !Array.isArray(value.warnings) ||
    !isRecord(value.owner) ||
    value.kind !== (mode === "deposit" ? "save-deposit" : "save-withdraw") ||
    value.owner.subject !== session.user.subject ||
    value.owner.accountProvider !== session.accountProvider ||
    value.owner.chainId !== 8453 ||
    typeof value.owner.address !== "string" ||
    value.owner.address.toLowerCase() !== session.smartAccount?.address.toLowerCase()
  ) {
    throw new SavingsActionClientError("The prepared action did not match the verified account or requested savings action.");
  }
  return value as PreparedMoneyAction;
}

function messageForPrepareError(error: unknown): string {
  if (error instanceof SavingsActionClientError) return error.message;
  const status = isRecord(error) && typeof error.status === "number" ? error.status : null;
  const code = isRecord(error) && typeof error.code === "string" ? error.code : null;
  const serverMessage = isRecord(error) && typeof error.serverMessage === "string"
    ? error.serverMessage
    : null;
  if (code === "SAVINGS_ACTION_INVALID" || status === 400) {
    return "Enter a valid positive USDC amount for a configured vault.";
  }
  if (code === "SAVINGS_ACTION_LIMIT_EXCEEDED" || status === 409) {
    return "That amount exceeds the current onchain account balance or vault limit. No transaction was submitted.";
  }
  if (code === "SAVINGS_ACTION_UNSUPPORTED" || status === 422) {
    return "This vault no longer has a verified supported canonical-USDC action route.";
  }
  if (code === "UNAUTHENTICATED") {
    return "Your verified account changed. Sign in again to prepare this savings action.";
  }
  if (code === "AUTH_UNAVAILABLE") {
    return "Authentication is temporarily unavailable. No transaction was submitted.";
  }
  if (code === "SAVINGS_ACTION_ISSUE") {
    return "The savings review could not be stored for this account. No transaction was submitted.";
  }
  if (code && serverMessage && isSafePrepareMessage(serverMessage)) {
    return `${serverMessage} (${code}) No transaction was submitted.`;
  }
  if (code && code !== "SAVINGS_ACTION_UNAVAILABLE") {
    return `Savings action preparation failed (${code}). No transaction was submitted.`;
  }
  return "Savings action preparation is temporarily unavailable. No transaction was submitted.";
}

function isSafePrepareMessage(message: string): boolean {
  return message.length > 0 && message.length <= 240 && !/[<>]/.test(message) && !/https?:\/\//i.test(message);
}

class SavingsActionClientError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
