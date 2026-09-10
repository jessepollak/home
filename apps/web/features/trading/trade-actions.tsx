"use client";

import { signEvmTypedData } from "@coinbase/cdp-core";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { BaseAccountConnectorError } from "@/features/account/base-account-connector";
import { useAccountWallet } from "@/features/account/cdp-client";
import type { VerifiedAccountSession } from "@/features/account/session-types";
import { MoneyActionReview } from "@/features/money-actions/review";
import { useMoneyDataRefresh } from "@/features/money-actions/refresh";
import type { PreparedMoneyAction } from "@/features/money-actions/types";
import {
  MoneyAmountDisplay,
  MoneyModal,
  MoneyModalFooter,
  MoneyModalHeader,
  MoneyNumpad,
  isPositiveDecimalAmount,
  useMoneyAssetPricing,
} from "@/features/money-modal";
import modal from "@/features/money-modal/money-modal.module.css";
import type { InvestAsset } from "@/config/invest-assets";
import {
  getTradeAssetStatus,
  getTradeSellAsset,
  type TradeAsset,
  type TradeSide,
} from "./assets";
import { formatTradeBaseUnits, parseTradeAmount } from "./amount";
import {
  DEFAULT_TRADE_SLIPPAGE_BPS,
  TradeClientError,
  type PrepareTradeRequest,
  type TradeApiErrorCode,
  type TradeIntentReview,
  type TradeUnavailableReason,
} from "./types";
import styles from "./trade-actions.module.css";

export function TradeActions({
  asset,
  layout = "row",
}: {
  asset: InvestAsset;
  layout?: "row" | "sticky";
}) {
  const account = useAccountWallet();
  const refreshMoneyData = useMoneyDataRefresh();
  const status = getTradeAssetStatus(asset.id);
  const [side, setSide] = useState<TradeSide | null>(null);
  const [modalBoundary, setModalBoundary] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<TradeIntentReview | null>(null);
  const [action, setAction] = useState<PreparedMoneyAction | null>(null);
  const requestController = useRef<AbortController | null>(null);
  const boundary = accountBoundary(account);
  const activeBoundary = modalBoundary === boundary ? modalBoundary : null;
  const visibleSide = activeBoundary ? side : null;
  const visibleIntent = activeBoundary ? intent : null;
  const dropPrivate = modalBoundary !== null && modalBoundary !== boundary;
  const visibleAction = action && actionMatchesSession(action, account.session) ? action : null;
  const amountOpen = visibleSide !== null && !visibleIntent && !visibleAction;
  const permitDialogRef = useDialog(Boolean(visibleIntent && !visibleAction));

  useEffect(() => () => requestController.current?.abort(), []);

  if (!status) return null;
  if (status.status === "eligibility-required") {
    return (
      <div className={layout === "sticky" ? styles.lockedSticky : styles.locked} role="note">
        Stock execution requires verified issuer and provider eligibility.
      </div>
    );
  }

  const tradeAsset = status.asset;
  const canTrade =
    account.status === "verified" &&
    (account.session?.accountProvider === "cdp-embedded" ||
      account.session?.accountProvider === "base-account") &&
    Boolean(boundary);

  function open(nextSide: TradeSide) {
    if (!canTrade) return;
    setModalBoundary(boundary);
    setSide(nextSide);
    setAmount("");
    setError(null);
    setIntent(null);
  }

  function resetTrade() {
    if (preparing) requestController.current?.abort();
    requestController.current = null;
    setSide(null);
    setAmount("");
    setPreparing(false);
    setSigning(false);
    setError(null);
    setIntent(null);
  }

  function close() {
    setModalBoundary(null);
    resetTrade();
  }

  function closeAmount() {
    resetTrade();
  }

  function finishAmountClose() {
    if (modalBoundary !== boundary || side === null) {
      setModalBoundary(null);
      resetTrade();
    }
  }

  async function prepare() {
    if (!side || !boundary || !account.session?.smartAccount) return;
    const sellAsset = getTradeSellAsset(tradeAsset, side);
    let amountBaseUnits: string;
    try { amountBaseUnits = parseTradeAmount(amount, sellAsset.decimals); } catch {
      setError(`Enter a positive ${sellAsset.symbol} amount with no more than ${sellAsset.decimals} decimal places.`);
      return;
    }
    const request: PrepareTradeRequest = {
      assetId: tradeAsset.id as PrepareTradeRequest["assetId"],
      side,
      amountBaseUnits,
      slippageBps: DEFAULT_TRADE_SLIPPAGE_BPS,
    };
    const controller = new AbortController();
    requestController.current?.abort();
    requestController.current = controller;
    setPreparing(true);
    setError(null);
    try {
      const payload = await account.fetchAccountResource("/api/trades", {
        method: "POST",
        body: request,
        signal: controller.signal,
      });
      const unavailableReason = parseUnavailableReason(payload);
      if (unavailableReason) throw new TradeClientError(codeForUnavailableReason(unavailableReason));
      const prepared = parseTradeIntent(payload, account.session);
      if (!prepared) throw new TradeClientError("TRADE_UNAVAILABLE");
      setIntent(prepared);
    } catch (caught) {
      if (!controller.signal.aborted) setError(messageForTradeError(caught));
    } finally {
      if (requestController.current === controller) {
        requestController.current = null;
        setPreparing(false);
      }
    }
  }

  async function signAndFinalize() {
    if (!visibleIntent || !activeBoundary || accountBoundary(account) !== activeBoundary) return;
    setSigning(true);
    setError(null);
    try {
      const signature = account.session?.accountProvider === "base-account"
        ? await account.signTypedData(visibleIntent.permit)
        : (await signEvmTypedData({
            evmAccount: visibleIntent.signerAddress,
            typedData: visibleIntent.signingTypedData,
            idempotencyKey: visibleIntent.signingRequestId,
          })).signature;
      const payload = await account.fetchAccountResource(
        `/api/trades/${encodeURIComponent(visibleIntent.id)}/finalize`,
        {
          method: "POST",
          body: { intentHash: visibleIntent.intentHash, signature },
        },
      );
      const unavailableReason = parseUnavailableReason(payload);
      if (unavailableReason) throw new TradeClientError(codeForUnavailableReason(unavailableReason));
      const prepared = parsePreparedTradeAction(payload, account.session);
      if (!prepared) throw new TradeClientError("TRADE_UNAVAILABLE");
      setIntent(null);
      setAction(prepared);
    } catch (caught) {
      if (caught instanceof BaseAccountConnectorError && caught.reason === "cancelled") {
        setError("The wallet request was rejected.");
      } else {
        setError(messageForTradeError(caught));
      }
    } finally {
      setSigning(false);
    }
  }

  return (
    <>
      <div
        className={layout === "sticky" ? styles.stickyActions : styles.rowActions}
        aria-label={`Trade ${asset.displayName}`}
      >
        <button type="button" disabled={!canTrade} onClick={() => open("buy")}>Buy</button>
        <button type="button" disabled={!canTrade} onClick={() => open("sell")}>Sell</button>
      </div>

      <TradeAmountDialog
        open={amountOpen}
        side={visibleSide}
        asset={tradeAsset}
        amount={amount}
        preparing={preparing}
        error={error}
        immediate={dropPrivate}
        onAmountChange={setAmount}
        onContinue={() => void prepare()}
        onClose={closeAmount}
        onClosed={finishAmountClose}
      />

      <TradePermitReview
        dialogRef={permitDialogRef}
        intent={visibleIntent}
        signing={signing}
        error={error}
        onSign={signAndFinalize}
        onClose={close}
      />

      {visibleAction ? (
        <MoneyActionReview
          action={visibleAction}
          onClose={() => { setAction(null); close(); }}
          onConfirmed={() => {
            setAction(null);
            close();
            refreshMoneyData();
          }}
        />
      ) : null}
    </>
  );
}

function TradeAmountDialog({
  open,
  side,
  asset,
  amount,
  preparing,
  error,
  immediate,
  onAmountChange,
  onContinue,
  onClose,
  onClosed,
}: {
  open: boolean;
  side: TradeSide | null;
  asset: TradeAsset;
  amount: string;
  preparing: boolean;
  error: string | null;
  immediate: boolean;
  onAmountChange: (value: string) => void;
  onContinue: () => void;
  onClose: () => void;
  onClosed: () => void;
}) {
  const sellAsset = side ? getTradeSellAsset(asset, side) : null;
  const pricing = useMoneyAssetPricing(sellAsset?.symbol ?? "USDC");
  if (!side || !sellAsset) {
    return (
      <MoneyModal
        open={false}
        labelledBy="trade-amount-title"
        immediate={immediate}
        onCancel={onClose}
        onClose={onClosed}
      >
        <MoneyModalHeader title="Buy" titleId="trade-amount-title" onClose={onClose} />
      </MoneyModal>
    );
  }

  return (
    <MoneyModal
      open={open}
      labelledBy="trade-amount-title"
      immediate={immediate}
      onCancel={() => {
        if (preparing) return false;
        onClose();
        return true;
      }}
      onClose={onClosed}
    >
      <MoneyModalHeader
        title={side === "buy" ? "Buy" : "Sell"}
        titleId="trade-amount-title"
        onClose={onClose}
        closeDisabled={preparing}
        closeLabel="Close trade"
      />
      <div className={modal.body}>
        {/*
          Max stays off: TradeActions is not given a spendable balance field.
          Do not invent fee/dust math or claim a backend available-spend.
        */}
        <MoneyAmountDisplay
          amount={amount}
          onAmountChange={onAmountChange}
          assetId={sellAsset.id}
          assetLabel={sellAsset.symbol}
          assetCurrency={sellAsset.id === "usdc" ? "USD" : null}
          assetLocked
          chipSet={side === "buy" ? "quick-local" : "max"}
          pricing={pricing}
          nativeSymbol={sellAsset.symbol}
        />
        <MoneyNumpad
          value={amount}
          maxDecimals={sellAsset.decimals}
          onChange={onAmountChange}
          disabled={preparing}
        />
        {error ? <p className={modal.error} role="alert">{error}</p> : null}
      </div>
      <MoneyModalFooter
        primaryLabel={preparing ? "Preparing…" : "Continue"}
        primaryDisabled={preparing || !isPositiveDecimalAmount(amount)}
        onPrimary={onContinue}
      />
    </MoneyModal>
  );
}

function TradePermitReview({
  dialogRef, intent, signing, error, onSign, onClose,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  intent: TradeIntentReview | null;
  signing: boolean;
  error: string | null;
  onSign: () => void;
  onClose: () => void;
}) {
  if (!intent) return <dialog ref={dialogRef} className={styles.dialog} />;
  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={`trade-intent-${intent.id}`}
      onCancel={(event) => { event.preventDefault(); if (!signing) onClose(); }}
      onClose={() => { if (!signing) onClose(); }}>
      <header>
        <h2 id={`trade-intent-${intent.id}`}>{intent.title}</h2>
        <button type="button" disabled={signing} onClick={onClose} aria-label="Close trade review">×</button>
      </header>
      <div className={styles.reviewBody}>
        <dl>
          <div><dt>Spend</dt><dd>{formatTradeBaseUnits(BigInt(intent.spend.amountBaseUnits), intent.spend.decimals)} {intent.spend.symbol}</dd></div>
          <div><dt>Minimum received</dt><dd>{formatTradeBaseUnits(BigInt(intent.receive.minimumAmountBaseUnits), intent.receive.decimals)} {intent.receive.symbol}</dd></div>
          <div><dt>Permit expires</dt><dd>{new Date(intent.permitExpiresAt).toLocaleString()}</dd></div>
        </dl>
        <ul>{intent.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        <p>Signing authorizes Permit2 for the exact spend. After signature, review and confirm the final swap calls.</p>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <button className={styles.prepare} type="button" disabled={signing} onClick={onSign}>
          {signing ? "Signing permit…" : "Authorize exact spend"}
        </button>
      </div>
    </dialog>
  );
}

function useDialog(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      dialog.querySelector<HTMLElement>("input, button:not(:disabled)")?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
      restoreFocus.current?.focus();
      restoreFocus.current = null;
    }
  }, [open]);
  return ref;
}

function accountBoundary(account: ReturnType<typeof useAccountWallet>): string | null {
  const session = account.status === "verified" ? account.session : null;
  return account.ownerKey && session?.smartAccount
    ? `${account.ownerKey}\u0000${session.user.subject}\u0000${session.smartAccount.address}\u0000${session.accountProvider}`
    : null;
}

function actionMatchesSession(action: PreparedMoneyAction, session: VerifiedAccountSession | null): boolean {
  return Boolean(session?.smartAccount && action.owner.subject === session.user.subject &&
    action.owner.address === session.smartAccount.address && action.owner.chainId === 8453 &&
    action.owner.accountProvider === session.accountProvider);
}

function parseTradeIntent(
  value: unknown,
  session: VerifiedAccountSession | null,
): TradeIntentReview | null {
  if (!session?.smartAccount || !isRecord(value) || value.status !== "signature-required") return null;
  if (
    typeof value.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id) ||
    typeof value.intentHash !== "string" || !/^[0-9a-f]{64}$/.test(value.intentHash) ||
    typeof value.title !== "string" ||
    typeof value.signerAddress !== "string" || !/^0x[0-9a-f]{40}$/.test(value.signerAddress) ||
    value.signingRequestId !== `trade-permit:${value.id}` ||
    !isRecord(value.signingTypedData) || !isRecord(value.signingTypedData.domain) ||
    value.signingTypedData.domain.name !== "Coinbase Smart Wallet" ||
    value.signingTypedData.domain.version !== "1" ||
    value.signingTypedData.domain.chainId !== 8453 ||
    value.signingTypedData.domain.verifyingContract !== session.smartAccount.address ||
    value.signingTypedData.primaryType !== "CoinbaseSmartWalletMessage" ||
    !isExactSigningTypes(value.signingTypedData.types) ||
    !isRecord(value.signingTypedData.message) ||
    typeof value.signingTypedData.message.hash !== "string" ||
    !/^0x[0-9a-f]{64}$/.test(value.signingTypedData.message.hash) ||
    !isTradeReviewAmount(value.spend, false) ||
    !isTradeReviewAmount(value.receive, true) ||
    !isPermitTypedData(value.permit) ||
    !Array.isArray(value.warnings) || value.warnings.length > 12 ||
    !value.warnings.every((warning) => typeof warning === "string") ||
    typeof value.permitExpiresAt !== "string" || typeof value.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(value.permitExpiresAt)) || Date.parse(value.expiresAt) <= Date.now()
  ) return null;
  return value as unknown as TradeIntentReview;
}

function isPermitTypedData(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.domain) || !isRecord(value.message) || !isRecord(value.types)) return false;
  return value.primaryType === "PermitTransferFrom" &&
    value.domain.name === "Permit2" &&
    value.domain.chainId === 8453 &&
    typeof value.domain.verifyingContract === "string" &&
    /^0x[0-9a-f]{40}$/.test(value.domain.verifyingContract);
}

function isTradeReviewAmount(value: unknown, receive: boolean): boolean {
  if (!isRecord(value)) return false;
  const amount = receive ? value.minimumAmountBaseUnits : value.amountBaseUnits;
  return typeof value.assetId === "string" &&
    typeof value.symbol === "string" &&
    Number.isSafeInteger(value.decimals) && Number(value.decimals) >= 0 && Number(value.decimals) <= 255 &&
    typeof amount === "string" && /^(?:0|[1-9][0-9]*)$/.test(amount) && BigInt(amount) > BigInt(0);
}

function isExactSigningTypes(value: unknown): boolean {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "CoinbaseSmartWalletMessage,EIP712Domain") return false;
  return JSON.stringify(value.EIP712Domain) === JSON.stringify([
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ]) && JSON.stringify(value.CoinbaseSmartWalletMessage) === JSON.stringify([
    { name: "hash", type: "bytes32" },
  ]);
}

function parsePreparedTradeAction(value: unknown, session: VerifiedAccountSession | null): PreparedMoneyAction | null {
  if (!session?.smartAccount || !isRecord(value) || value.kind !== "swap") return null;
  if (
    typeof value.id !== "string" || typeof value.reviewHash !== "string" || typeof value.title !== "string" ||
    typeof value.createdAt !== "string" || typeof value.expiresAt !== "string" || !Array.isArray(value.calls) ||
    value.calls.length < 1 || value.calls.length > 2 || !Array.isArray(value.amounts) || value.amounts.length !== 2 ||
    !Array.isArray(value.warnings) || !isRecord(value.owner) || value.owner.subject !== session.user.subject ||
    value.owner.address !== session.smartAccount.address || value.owner.chainId !== 8453 ||
    value.owner.accountProvider !== session.accountProvider
  ) return null;
  if (!value.calls.every((call) => isRecord(call) && typeof call.to === "string" && /^0x[0-9a-f]{40}$/.test(call.to) &&
    typeof call.data === "string" && /^0x[0-9a-fA-F]+$/.test(call.data) && typeof call.value === "string" && /^(?:0|[1-9]\d*)$/.test(call.value)) ||
    !value.warnings.every((warning) => typeof warning === "string") || !Number.isFinite(Date.parse(value.createdAt)) ||
    !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()
  ) return null;
  return value as unknown as PreparedMoneyAction;
}

function parseUnavailableReason(value: unknown): TradeUnavailableReason | null {
  if (!isRecord(value) || value.status !== "unavailable") return null;
  return ["insufficient-balance", "no-liquidity", "stale-quote", "quote-rejected", "signer-unsupported", "permit-expired", "permit-used"]
    .includes(value.reason as string) ? value.reason as TradeUnavailableReason : null;
}

function codeForUnavailableReason(reason: TradeUnavailableReason): TradeApiErrorCode {
  switch (reason) {
    case "insufficient-balance": return "INSUFFICIENT_BALANCE";
    case "no-liquidity": return "NO_LIQUIDITY";
    case "stale-quote": return "STALE_QUOTE";
    case "signer-unsupported": return "SIGNER_UNSUPPORTED";
    case "permit-expired": return "PERMIT_EXPIRED";
    case "permit-used": return "PERMIT_USED";
    default: return "QUOTE_REJECTED";
  }
}

function messageForTradeError(error: unknown): string {
  const code = readTradeErrorCode(error);
  switch (code) {
    case "NO_LIQUIDITY": return "CDP has no supported route for this exact pair and amount.";
    case "INSUFFICIENT_BALANCE": return "Your fresh Base balance is lower than this spend amount.";
    case "STALE_QUOTE": return "The quote became stale. Request a fresh review.";
    case "SIGNER_UNSUPPORTED": return "This verified account cannot sign this trade.";
    case "PERMIT_EXPIRED": return "The permit signing window expired. Request a fresh quote.";
    case "PERMIT_USED": return "This Permit2 nonce was already used. Request a fresh quote.";
    case "STOCK_EXECUTION_UNAVAILABLE": return "Stock execution remains locked until issuer and provider eligibility can be verified.";
    case "HOSTED_SWAP_UNAVAILABLE": return "Swaps aren’t available right now. No trade was submitted. Try again later.";
    case "QUOTE_REJECTED": return "CDP returned a quote that did not match the reviewed token, amount, Permit2, or slippage constraints.";
    case "INVALID_TRADE_FINALIZATION": return "The signature did not match this reviewed trade. Request a fresh quote.";
    case "INVALID_TRADE_REQUEST": return "Enter a valid exact amount for this allowlisted Base asset.";
    case "UNAUTHENTICATED": return "Your verified account changed. Open the trade again.";
    default: return "A fresh CDP trade is unavailable. No trade was submitted.";
  }
}

function readTradeErrorCode(error: unknown): TradeApiErrorCode | "UNAUTHENTICATED" | null {
  if (error instanceof TradeClientError) return error.code;
  if (isRecord(error) && typeof error.code === "string") return error.code as TradeApiErrorCode;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
