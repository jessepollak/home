"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  useAccountWallet,
  type AccountWalletClient,
} from "@/features/account/cdp-client";
import { formatTokenAmount } from "@/features/formatting";
import { MoneyActionReview } from "@/features/money-actions/review";
import type { PreparedMoneyAction } from "@/features/money-actions/types";
import {
  TRANSFER_ASSETS,
  assertTransferRequest,
  formatTransferAmount,
  normalizeTransferRecipient,
  parseTransferAmount,
} from "./transfer-helpers";
import {
  TransferExecutionError,
  type ConfirmedTransfer,
  type PendingTransfer,
  type TransferAssetId,
  type TransferRequest,
} from "./types";
import styles from "./transfers.module.css";

export type TransferActionsProps = {
  onTransferConfirmed?: (transfer: ConfirmedTransfer) => void;
};

type TransferWallet = Pick<
  AccountWalletClient,
  | "ownerKey"
  | "status"
  | "session"
  | "pendingTransfer"
  | "sendTransfer"
  | "checkPendingTransfer"
  | "startNewTransfer"
> & Partial<Pick<AccountWalletClient, "prepareMoneyAction" | "executeMoneyAction" | "fetchOperations">>;

type SendStep = "compose" | "review" | "pending" | "recovery" | "failed" | "success" | "error";

export function TransferActions(props: TransferActionsProps) {
  const wallet = useAccountWallet();
  return <TransferActionsForWallet wallet={wallet} {...props} />;
}

export function TransferActionsForWallet({
  wallet,
  onTransferConfirmed,
}: TransferActionsProps & { wallet: TransferWallet }) {
  const [openModal, setOpenModal] = useState<"send" | "receive" | null>(null);
  const [modalOwner, setModalOwner] = useState<string | null>(null);
  const boundary = walletBoundary(wallet);
  const verifiedAddress =
    wallet.status === "verified" ? wallet.session?.smartAccount?.address ?? null : null;
  const visibleModal = modalOwner === boundary ? openModal : null;

  const open = (modal: "send" | "receive") => {
    if (!boundary) return;
    setModalOwner(boundary);
    setOpenModal(modal);
  };
  const close = () => {
    setOpenModal(null);
    setModalOwner(null);
  };

  return (
    <div className={styles.actions} aria-label="Transfer actions">
      <button
        className={styles.secondaryAction}
        type="button"
        disabled={!boundary}
        onClick={() => open("send")}
      >
        Send
      </button>
      <button
        className={styles.secondaryAction}
        type="button"
        disabled={!boundary}
        onClick={() => open("receive")}
      >
        Receive
      </button>

      <ReceiveDialog
        open={visibleModal === "receive"}
        address={verifiedAddress}
        onClose={close}
      />
      <SendDialog
        open={visibleModal === "send"}
        address={verifiedAddress}
        pendingTransfer={wallet.pendingTransfer}
        sendTransfer={wallet.sendTransfer}
        checkPendingTransfer={wallet.checkPendingTransfer}
        startNewTransfer={wallet.startNewTransfer}
        prepareMoneyAction={wallet.prepareMoneyAction}
        executeMoneyAction={wallet.executeMoneyAction}
        fetchOperations={wallet.fetchOperations}
        onTransferConfirmed={onTransferConfirmed}
        onClose={close}
      />
    </div>
  );
}

function ReceiveDialog({
  open,
  address,
  onClose,
}: {
  open: boolean;
  address: `0x${string}` | null;
  onClose: () => void;
}) {
  const dialogRef = useDialog(open);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">(
    "idle",
  );

  const close = () => {
    setCopyStatus("idle");
    onClose();
  };

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

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="receive-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClose={close}
    >
      {open ? (
        <>
      <header className={styles.dialogHeader}>
        <div>
          <p className={styles.kicker}>Base network</p>
          <h2 id="receive-title">Receive</h2>
        </div>
        <button className={styles.closeButton} type="button" onClick={close}>
          <span aria-hidden="true">×</span>
          <span className={styles.srOnly}>Close receive dialog</span>
        </button>
      </header>

      <div className={styles.warning} role="note">
        Send only assets supported on Base (chain 8453) to this address. Assets sent
        on another network may be lost.
      </div>
      <p className={styles.addressLabel}>Your verified smart-account address</p>
      <output className={styles.address}>{address ?? "Address unavailable"}</output>
      <button
        className={styles.primaryButton}
        type="button"
        disabled={!address}
        onClick={() => void copyAddress()}
      >
        {copyStatus === "copied" ? "Copied" : "Copy address"}
      </button>
      <p
        className={copyStatus === "error" ? styles.errorText : styles.statusText}
        role={copyStatus === "error" ? "alert" : "status"}
        aria-live="polite"
      >
        {copyStatus === "copied"
          ? "Address copied to your clipboard."
          : copyStatus === "error"
            ? "Clipboard access failed. Select and copy the address manually."
            : ""}
      </p>
        </>
      ) : null}
    </dialog>
  );
}

function SendDialog({
  open,
  address,
  pendingTransfer,
  sendTransfer,
  checkPendingTransfer,
  startNewTransfer,
  prepareMoneyAction,
  executeMoneyAction,
  fetchOperations,
  onTransferConfirmed,
  onClose,
}: {
  open: boolean;
  address: `0x${string}` | null;
  pendingTransfer: PendingTransfer | null;
  sendTransfer: TransferWallet["sendTransfer"];
  checkPendingTransfer: TransferWallet["checkPendingTransfer"];
  startNewTransfer: TransferWallet["startNewTransfer"];
  prepareMoneyAction?: AccountWalletClient["prepareMoneyAction"];
  executeMoneyAction?: AccountWalletClient["executeMoneyAction"];
  fetchOperations?: AccountWalletClient["fetchOperations"];
  onTransferConfirmed?: (transfer: ConfirmedTransfer) => void;
  onClose: () => void;
}) {
  const dialogRef = useDialog(open);
  const [assetId, setAssetId] = useState<TransferAssetId>("usdc");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [request, setRequest] = useState<TransferRequest | null>(null);
  const [intentId, setIntentId] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<ConfirmedTransfer | null>(null);
  const [preparedAction, setPreparedAction] = useState<PreparedMoneyAction | null>(null);
  const [recoveringAction, setRecoveringAction] = useState(false);
  const [step, setStep] = useState<SendStep>("compose");
  const [error, setError] = useState<string | null>(null);
  const displayStep = open && pendingTransfer && step === "compose" ? "recovery" : step;
  const displayRequest: TransferRequest | PendingTransfer | null =
    request ?? pendingTransfer;
  const displayError =
    error ?? (displayStep === "recovery" && pendingTransfer
      ? messageForPendingTransfer(pendingTransfer)
      : null);

  useEffect(() => {
    if (!open || !fetchOperations || preparedAction || step !== "compose") return;
    let active = true;
    void fetchOperations().then((value) => {
      if (!active || !value || typeof value !== "object" || !("operations" in value) || !Array.isArray(value.operations)) return;
      const operation = value.operations.find((candidate) =>
        candidate && typeof candidate === "object" && "status" in candidate &&
        ["submitting", "submitted", "included", "unknown"].includes(String(candidate.status)) &&
        "action" in candidate && candidate.action && typeof candidate.action === "object" &&
        "kind" in candidate.action && candidate.action.kind === "send",
      ) as { action?: PreparedMoneyAction } | undefined;
      const recoveredRequest = operation?.action ? requestFromSendAction(operation.action) : null;
      if (operation?.action && recoveredRequest) {
        setPreparedAction(operation.action);
        setRequest(recoveredRequest);
        setRecoveringAction(true);
        setStep("review");
      }
    }).catch(() => {
      // Recent-operation recovery is best effort; composing remains available.
    });
    return () => { active = false; };
  }, [fetchOperations, open, preparedAction, step]);

  function reset() {
    setAssetId("usdc");
    setRecipient("");
    setAmount("");
    setRequest(null);
    setIntentId(null);
    setConfirmed(null);
    setPreparedAction(null);
    setRecoveringAction(false);
    setStep("compose");
    setError(null);
  }

  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      if (!address) throw new TransferExecutionError("unavailable");
      const normalizedRecipient = normalizeTransferRecipient(recipient);
      const amountBaseUnits = parseTransferAmount(
        amount,
        TRANSFER_ASSETS[assetId].decimals,
      );
      const nextRequest = {
        assetId,
        recipient: normalizedRecipient,
        amountBaseUnits,
      } satisfies TransferRequest;
      assertTransferRequest(nextRequest);
      setRequest(nextRequest);
      setIntentId(crypto.randomUUID());
      setError(null);
      if (prepareMoneyAction) {
        setStep("pending");
        setPreparedAction(await prepareMoneyAction("/api/actions/send/prepare", nextRequest));
      }
      setStep("review");
    } catch {
      setError(
        `Enter a valid Base address and a positive ${TRANSFER_ASSETS[assetId].symbol} amount with no more than ${TRANSFER_ASSETS[assetId].decimals} decimal places.`,
      );
    }
  }

  async function confirm() {
    if (!request || !intentId || step === "pending") return;
    setError(null);
    setStep("pending");
    try {
      complete(await sendTransfer(request, intentId));
    } catch (caught) {
      setError(messageForTransferError(caught, true));
      setStep(
        isRecoverableSubmission(caught)
          ? "recovery"
          : isExplicitSubmissionFailure(caught)
            ? "failed"
            : "error",
      );
    }
  }

  async function checkStatus() {
    if (step === "pending") return;
    setError(null);
    setStep("pending");
    try {
      complete(await checkPendingTransfer());
    } catch (caught) {
      setError(messageForTransferError(caught, true));
      setStep("recovery");
    }
  }

  function complete(result: ConfirmedTransfer) {
    setConfirmed(result);
    setStep("success");
    try {
      onTransferConfirmed?.(result);
    } catch {
      // A parent refresh failure must not relabel a receipt-confirmed transfer.
    }
  }

  const closeIfAllowed = () => {
    if (step !== "pending" || pendingTransfer) {
      reset();
      onClose();
    }
  };

  const handleDialogClose = () => {
    reset();
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="send-title"
      aria-describedby={displayStep === "pending" ? "send-pending" : undefined}
      onCancel={(event) => {
        event.preventDefault();
        closeIfAllowed();
      }}
      onClose={handleDialogClose}
    >
      {open ? (
        <>
      <header className={styles.dialogHeader}>
        <div>
          <p className={styles.kicker}>Base network</p>
          <h2 id="send-title">Send</h2>
        </div>
        <button
          className={styles.closeButton}
          type="button"
          disabled={displayStep === "pending" && !pendingTransfer}
          onClick={closeIfAllowed}
        >
          <span aria-hidden="true">×</span>
          <span className={styles.srOnly}>Close send dialog</span>
        </button>
      </header>

      {displayStep === "compose" ? (
        <form className={styles.form} onSubmit={review}>
          <label htmlFor="send-asset">Asset</label>
          <select
            id="send-asset"
            className={styles.input}
            value={assetId}
            onChange={(event) => setAssetId(event.target.value as TransferAssetId)}
          >
            <option value="usdc">USDC on Base</option>
            <option value="eth">Native ETH on Base</option>
          </select>

          <label htmlFor="send-recipient">Recipient address</label>
          <input
            id="send-recipient"
            className={styles.input}
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
            required
          />

          <label htmlFor="send-amount">Amount</label>
          <input
            id="send-amount"
            className={styles.input}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            autoComplete="off"
            required
          />
          <p className={styles.helpText}>
            Your exact, unrounded Base balance is checked again before signing.
          </p>
          {error ? <p className={styles.errorText} role="alert">{error}</p> : null}
          <button className={styles.primaryButton} type="submit" disabled={step === "pending"}>
            Review transfer
          </button>
        </form>
      ) : null}

      {displayRequest && preparedAction && displayStep === "review" && executeMoneyAction ? (
        <MoneyActionReview
          action={preparedAction}
          execute={executeMoneyAction}
          recovering={recoveringAction}
          onClose={() => {
            if (recoveringAction) {
              reset();
              onClose();
              return;
            }
            setPreparedAction(null);
            setRecoveringAction(false);
            setError(null);
            setStep("compose");
          }}
          onConfirmed={(result) => {
            if (!result.transactionHash || !request) {
              setError("The operation is confirmed but its transaction hash is unavailable.");
              setStep("error");
              return;
            }
            complete({ ...request, transactionHash: result.transactionHash });
          }}
        />
      ) : displayRequest && (displayStep === "review" || displayStep === "pending" || displayStep === "recovery" || displayStep === "failed" || displayStep === "error") ? (
        <section className={styles.review} aria-labelledby="review-heading">
          <h3 id="review-heading">Review transfer</h3>
          <dl>
            <div>
              <dt>Asset</dt>
              <dd>{TRANSFER_ASSETS[displayRequest.assetId].symbol} on Base</dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd>
                {formatTransferAmount(
                  displayRequest.amountBaseUnits,
                  TRANSFER_ASSETS[displayRequest.assetId].decimals,
                )} {TRANSFER_ASSETS[displayRequest.assetId].symbol}
              </dd>
            </div>
            <div>
              <dt>To</dt>
              <dd className={styles.breakAddress}>{displayRequest.recipient}</dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>Base (8453)</dd>
            </div>
          </dl>
          {displayStep === "pending" ? (
            <div id="send-pending" className={styles.pending} role="status">
              <span className={styles.spinner} aria-hidden="true" />
              {pendingTransfer
                ? "Checking the existing submission for an onchain receipt…"
                : "Waiting for your wallet and an onchain receipt…"}
            </div>
          ) : null}
          {displayError ? <p className={styles.errorText} role="alert">{displayError}</p> : null}
          {displayStep === "recovery" ? (
            <>
              <div className={styles.buttonRow}>
                <button className={styles.secondaryButton} type="button" onClick={closeIfAllowed}>
                  Close safely
                </button>
                <button
                  className={styles.primaryButton}
                  type="button"
                  onClick={() => void checkStatus()}
                >
                  Check existing submission
                </button>
              </div>
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={() => {
                  startNewTransfer();
                  reset();
                }}
              >
                Start a new transfer instead
              </button>
              <p className={styles.helpText}>
                A new transfer is a separate intent and could duplicate an unresolved submission. Check your wallet first.
              </p>
            </>
          ) : displayStep === "failed" ? (
            <div className={styles.buttonRow}>
              <button className={styles.secondaryButton} type="button" onClick={closeIfAllowed}>
                Close
              </button>
              <button
                className={styles.primaryButton}
                type="button"
                onClick={() => {
                  startNewTransfer();
                  reset();
                }}
              >
                Compose a new transfer
              </button>
            </div>
          ) : (
            <div className={styles.buttonRow}>
              <button
                className={styles.secondaryButton}
                type="button"
                disabled={step === "pending"}
                onClick={() => {
                  setError(null);
                  setStep("compose");
                }}
              >
                Back
              </button>
              <button
                className={styles.primaryButton}
                type="button"
                disabled={step === "pending"}
                onClick={() => void confirm()}
              >
                Confirm and send
              </button>
            </div>
          )}
        </section>
      ) : null}

      {displayStep === "success" && confirmed ? (
        <section className={styles.success} role="status">
          <h3>Transfer confirmed</h3>
          <p>
            {formatTokenAmount(
              confirmed.amountBaseUnits,
              TRANSFER_ASSETS[confirmed.assetId].decimals,
            )} {TRANSFER_ASSETS[confirmed.assetId].symbol} sent on Base.
          </p>
          <p>The Base transaction has an onchain success receipt.</p>
          <p className={styles.hashLabel}>Transaction hash</p>
          <output className={styles.breakAddress}>{confirmed.transactionHash}</output>
          <button className={styles.primaryButton} type="button" onClick={closeIfAllowed}>
            Done
          </button>
        </section>
      ) : null}
        </>
      ) : null}
    </dialog>
  );
}

function useDialog(open: boolean) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      restoreFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      dialog.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled)")?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return dialogRef;
}

function requestFromSendAction(action: PreparedMoneyAction): TransferRequest | null {
  if (action.kind !== "send" || action.calls.length !== 1) return null;
  const spend = action.amounts.find((amount) => amount.direction === "spend");
  if (!spend || (spend.assetId !== "usdc" && spend.assetId !== "eth")) return null;
  const call = action.calls[0];
  let recipient: `0x${string}`;
  if (spend.assetId === "eth") {
    recipient = call.to;
  } else {
    if (!call.data.startsWith("0xa9059cbb") || call.data.length !== 138) return null;
    recipient = `0x${call.data.slice(34, 74)}` as `0x${string}`;
  }
  try {
    const request = { assetId: spend.assetId, recipient, amountBaseUnits: spend.amountBaseUnits } satisfies TransferRequest;
    assertTransferRequest(request);
    return request;
  } catch {
    return null;
  }
}

function walletBoundary(wallet: TransferWallet): string | null {
  const session = wallet.status === "verified" ? wallet.session : null;
  return wallet.ownerKey && session?.smartAccount
    ? `${wallet.ownerKey}\u0000${session.user.subject}\u0000${session.smartAccount.address}\u0000${session.accountProvider}`
    : null;
}

function isExplicitSubmissionFailure(error: unknown): boolean {
  return error instanceof TransferExecutionError && error.reason === "failed";
}

function isRecoverableSubmission(error: unknown): boolean {
  return (
    error instanceof TransferExecutionError &&
    (error.reason === "confirmation-timeout" ||
      error.reason === "submission-unknown" ||
      error.reason === "submission-pending")
  );
}

function messageForPendingTransfer(transfer: PendingTransfer): string {
  return transfer.state === "submitted"
    ? "This transfer was already submitted. Checking status will only inspect that same submission and will not send again."
    : "The wallet submission result is unknown. Do not resend automatically; check your wallet before starting a separate transfer.";
}

function messageForTransferError(error: unknown, afterDispatch = false): string {
  if (!(error instanceof TransferExecutionError)) {
    return afterDispatch
      ? "The submission outcome is unknown. Check your wallet before starting another transfer."
      : "The transfer failed before confirmation. No success is being shown.";
  }
  switch (error.reason) {
    case "rejected":
      return "The wallet request was rejected. No transfer was confirmed.";
    case "insufficient-balance":
      return "Your fresh Base balance is lower than this amount.";
    case "stale-session":
      return afterDispatch
        ? "Your account changed while confirmation was in progress. The prior submission may still settle; check that wallet before sending again."
        : "Your account changed or signed out before submission. No transfer was confirmed.";
    case "confirmation-timeout":
      return "The existing submission is still pending or its operation proof is incomplete. Checking again will not resubmit it.";
    case "submission-unknown":
      return "The wallet submission result is unknown. Check your wallet before starting a separate transfer.";
    case "submission-pending":
      return "An earlier transfer intent is unresolved. Check that submission instead of sending it again.";
    case "invalid-request":
      return "The recipient or amount is invalid. USDC cannot be sent to the USDC token contract.";
    default:
      return "The transfer did not produce a verified success receipt. Start a new transfer only after checking your wallet.";
  }
}
