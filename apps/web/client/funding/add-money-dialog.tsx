"use client";

import Link from "next/link";
import { useState, type RefObject } from "react";
import { ArrowDownToLine } from "lucide-react";
import { CurrencyMark } from "@/components/currency-mark";
import {
  verifiedLocalCashAssets,
  type DirectPortfolioAsset,
} from "@/config/portfolio-assets";
import {
  presentationRegions,
  type FiatCurrencyCode,
  type RegionId,
} from "@/config/regions";
import { formatAddress } from "@/shared/formatting";
import {
  MoneyModal,
  MoneyModalFooter,
  MoneyModalHeader,
} from "@/client/money-modal";
import modal from "@/client/money-modal/money-modal.module.css";
import styles from "./add-money.module.css";
import type { OnrampPaymentMethod } from "@/shared/funding/types";
import { ReceiveQr } from "./receive-qr";

export type AddMoneyStep = "method" | "receive" | "buy" | "pending";

export type OnrampPaymentSummary = {
  paymentAmount: string;
  paymentMethod: OnrampPaymentMethod;
};

export type PostCheckoutPayment = OnrampPaymentSummary;

export function AddMoneyDialog({
  open,
  step,
  address,
  openingOnramp,
  onrampError,
  paymentAmount,
  paymentMethod,
  activePayment,
  inlineOnrampUrl,
  inlineOnrampAttemptId,
  iframeRef,
  postCheckoutPayment,
  signedOut,
  regionId,
  onClose,
  onBack,
  onSelectReceive,
  onSelectBuy,
  onPaymentAmountChange,
  onPaymentMethodChange,
  onEditPayment,
  onCheckBalance,
  onContinueToCoinbase,
}: {
  open: boolean;
  step: AddMoneyStep;
  address: `0x${string}` | null;
  openingOnramp: boolean;
  onrampError: string | null;
  paymentAmount: string;
  paymentMethod: OnrampPaymentMethod;
  activePayment: OnrampPaymentSummary | null;
  inlineOnrampUrl: string | null;
  inlineOnrampAttemptId: number | null;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  postCheckoutPayment: PostCheckoutPayment | null;
  signedOut: boolean;
  regionId: RegionId;
  onClose: () => void;
  onBack: () => void;
  onSelectReceive: () => void;
  onSelectBuy: () => void;
  onPaymentAmountChange: (value: string) => void;
  onPaymentMethodChange: (value: OnrampPaymentMethod) => void;
  onEditPayment: () => void;
  onCheckBalance: () => void;
  onContinueToCoinbase: () => void;
}) {
  const title =
    step === "receive"
      ? "Receive"
      : step === "buy"
        ? "Buy"
        : step === "pending"
          ? "Deposit pending"
          : "Add money";

  return (
    <MoneyModal
      open={open}
      labelledBy="add-money-title"
      onCancel={onClose}
      onClose={onClose}
    >
      <MoneyModalHeader
        title={title}
        titleId="add-money-title"
        onBack={step === "method" || step === "pending" ? undefined : onBack}
        onClose={onClose}
        closeLabel="Close add money"
      />

      {signedOut ? <SignedOutBody /> : null}
      {!signedOut && step === "method" ? (
        <MethodBody onSelectReceive={onSelectReceive} onSelectBuy={onSelectBuy} />
      ) : null}
      {!signedOut && step === "receive" ? (
        <ReceiveBody address={address} regionId={regionId} />
      ) : null}
      {!signedOut && step === "buy" ? (
        <BuyBody
          paymentAmount={paymentAmount}
          paymentMethod={paymentMethod}
          activePayment={activePayment}
          inlineOnrampUrl={inlineOnrampUrl}
          inlineOnrampAttemptId={inlineOnrampAttemptId}
          iframeRef={iframeRef}
          onPaymentAmountChange={onPaymentAmountChange}
          onPaymentMethodChange={onPaymentMethodChange}
        />
      ) : null}
      {!signedOut && step === "pending" && postCheckoutPayment ? (
        <PostCheckoutBody payment={postCheckoutPayment} />
      ) : null}

      {onrampError && step === "buy" ? (
        <div className={styles.statusStack}>
          <p className={modal.error} role="alert">
            {onrampError}
          </p>
        </div>
      ) : null}

      {signedOut ? (
        <div className={modal.footer}>
          <Link className={modal.primary} href="/?account=signin">
            Sign in
          </Link>
        </div>
      ) : null}

      {!signedOut && step === "buy" ? (
        <MoneyModalFooter
          primaryLabel={
            openingOnramp
              ? "Opening Coinbase…"
              : activePayment
                ? "Change payment details"
                : "Continue to Coinbase"
          }
          primaryDisabled={openingOnramp}
          onPrimary={activePayment ? onEditPayment : onContinueToCoinbase}
          secondaryLabel="Back"
          onSecondary={onBack}
        />
      ) : null}

      {!signedOut && step === "pending" && postCheckoutPayment ? (
        <MoneyModalFooter
          primaryLabel="Close and check balance"
          onPrimary={onCheckBalance}
        />
      ) : null}
    </MoneyModal>
  );
}

export function MethodBody({
  onSelectReceive,
  onSelectBuy,
}: {
  onSelectReceive: () => void;
  onSelectBuy: () => void;
}) {
  return (
    <div className={modal.body}>
      <p className={styles.subtitle}>Fund this Base account</p>
      <div className={styles.methods}>
        <button className={styles.method} type="button" onClick={onSelectReceive}>
          <span className={styles.methodIcon} aria-hidden="true">
            <ArrowDownToLine size={18} strokeWidth={2.1} />
          </span>
          <span className={styles.methodCopy}>
            <span className={styles.methodTitle}>Receive crypto</span>
            <span className={styles.methodHint}>USDC and supported tokens on Base</span>
          </span>
          <span className={styles.methodChevron} aria-hidden="true">›</span>
        </button>
        <button className={styles.method} type="button" onClick={onSelectBuy}>
          <CurrencyMark currency="USD" symbol="$" />
          <span className={styles.methodCopy}>
            <span className={styles.methodTitle}>Buy USDC with Coinbase</span>
            <span className={styles.methodHint}>Hosted onramp to Base</span>
          </span>
          <span className={styles.methodChevron} aria-hidden="true">›</span>
        </button>
      </div>
    </div>
  );
}

export function ReceiveBody({
  address,
  regionId,
}: {
  address: `0x${string}` | null;
  regionId: RegionId;
}) {
  return (
    <div className={`${modal.body} ${styles.receive}`}>
      <p className={styles.network}>Receive on Base</p>
      <div className={styles.qrFrame}>
        {address ? (
          <ReceiveQr value={address} label={`QR code for Base address ${address}`} />
        ) : (
          <span className={`shimmer ${styles.qrShimmer}`} data-shimmer="qr" aria-hidden="true" />
        )}
      </div>
      <div className={styles.addressBlock}>
        {address ? (
          <ReceiveAddress address={address} />
        ) : (
          <>
            <span
              className={`shimmer ${styles.addressShimmer}`}
              data-shimmer="address"
              aria-hidden="true"
            />
            <p className={styles.addressHint}>Preparing your Base address</p>
          </>
        )}
      </div>
      <SupportedAssets regionId={regionId} />
    </div>
  );
}

function ReceiveAddress({ address }: { address: `0x${string}` }) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const condensed = formatAddress(address);

  async function copyAddress() {
    if (!navigator.clipboard?.writeText) {
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
    <>
      <button
        type="button"
        className={styles.addressText}
        title={address}
        aria-label={copyStatus === "copied" ? "Copied" : `Copy ${condensed}`}
        aria-describedby="receive-address-help"
        onClick={() => void copyAddress()}
      >
        {copyStatus === "copied" ? "Copied" : condensed}
      </button>
      {copyStatus === "error" ? (
        <div className={styles.copyFallback}>
          <p id="receive-address-help" className={styles.copyError} role="alert">
            Clipboard access is unavailable. Select and copy the full address below.
          </p>
          <code
            className={styles.fullAddress}
            aria-label={`Full Base address ${address}`}
            tabIndex={0}
          >
            {address}
          </code>
        </div>
      ) : (
        <p id="receive-address-help" className={styles.addressHint}>
          Tap the address to copy
        </p>
      )}
    </>
  );
}

export function BuyBody({
  paymentAmount,
  paymentMethod,
  activePayment,
  inlineOnrampUrl,
  inlineOnrampAttemptId,
  iframeRef,
  onPaymentAmountChange,
  onPaymentMethodChange,
}: {
  paymentAmount: string;
  paymentMethod: OnrampPaymentMethod;
  activePayment: OnrampPaymentSummary | null;
  inlineOnrampUrl: string | null;
  inlineOnrampAttemptId: number | null;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  onPaymentAmountChange: (value: string) => void;
  onPaymentMethodChange: (value: OnrampPaymentMethod) => void;
}) {
  return (
    <div className={`${modal.body} ${styles.buy}`}>
      <CurrencyMark currency="USD" symbol="$" />
      <h3 className={styles.buyTitle}>Buy USDC</h3>
      <p className={styles.buyLead}>
        {activePayment
          ? "Complete this payment in Coinbase. The amount and method below are fixed for this request."
          : "Choose a USD amount and Coinbase payment method. USDC is delivered on Base."}
      </p>

      {activePayment ? (
        <PaymentSummary payment={activePayment} sticky={Boolean(inlineOnrampUrl)} />
      ) : (
        <>
          <label className={styles.buyField} htmlFor="buy-usdc-amount">
            <span className={styles.buyLabel}>USD amount</span>
            <input
              id="buy-usdc-amount"
              className={styles.buyInput}
              inputMode="decimal"
              autoComplete="off"
              value={paymentAmount}
              onChange={(event) => onPaymentAmountChange(event.target.value)}
            />
          </label>

          <fieldset className={styles.paymentMethods}>
            <legend className={styles.buyLabel}>Payment method</legend>
            {(["apple-pay", "google-pay"] as const).map((method) => (
              <label className={styles.paymentMethod} key={method}>
                <input
                  type="radio"
                  name="coinbase-payment-method"
                  value={method}
                  checked={paymentMethod === method}
                  onChange={() => onPaymentMethodChange(method)}
                />
                <span>{paymentMethodLabel(method)}</span>
              </label>
            ))}
          </fieldset>
        </>
      )}

      {inlineOnrampUrl ? (
        <section className={styles.onrampEmbed} aria-label="Coinbase payment">
          <iframe
            key={inlineOnrampAttemptId}
            ref={iframeRef}
            title="Coinbase payment"
            className={styles.onrampFrame}
            src={inlineOnrampUrl}
            sandbox="allow-scripts allow-same-origin"
            referrerPolicy="no-referrer"
            allow="payment"
          />
        </section>
      ) : null}
    </div>
  );
}

export function PostCheckoutBody({
  payment,
}: {
  payment: PostCheckoutPayment;
}) {
  return (
    <div className={`${modal.body} ${styles.postCheckout}`}>
      <div className={styles.pendingMark} aria-hidden="true">…</div>
      <h3 className={styles.buyTitle}>Check your Base balance</h3>
      <p className={styles.buyLead}>
        Your deposit isn’t confirmed on Base. Close to refresh your balance.
      </p>
      <PaymentSummary payment={payment} />
    </div>
  );
}

function PaymentSummary({
  payment,
  sticky = false,
}: {
  payment: OnrampPaymentSummary;
  sticky?: boolean;
}) {
  return (
    <dl
      className={`${styles.paymentSummary} ${sticky ? styles.paymentSummarySticky : ""}`}
      aria-label="Coinbase payment details"
    >
      <div>
        <dt>Amount</dt>
        <dd>{formatPaymentAmount(payment.paymentAmount)}</dd>
      </div>
      <div>
        <dt>Method</dt>
        <dd>{paymentMethodLabel(payment.paymentMethod)}</dd>
      </div>
    </dl>
  );
}

function formatPaymentAmount(value: string): string {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount)
    : `$${value}`;
}

function paymentMethodLabel(method: OnrampPaymentMethod): string {
  return method === "apple-pay" ? "Apple Pay" : "Google Pay";
}

export function SupportedAssets({ regionId }: { regionId: RegionId }) {
  const region = presentationRegions[regionId];
  const localAsset = supportedRegionalAsset(region.currency.code);

  return (
    <section className={styles.supported} aria-label="Supported receive assets on Base">
      <p className={styles.supportedLabel}>Supported on Base</p>
      <div className={styles.supportedMarks}>
        <span className={styles.supportedAsset}>
          <CurrencyMark currency="USD" symbol="$" />
          <span>USDC</span>
        </span>
        {localAsset ? (
          <span className={styles.supportedAsset}>
            <CurrencyMark currency={localAsset.cashCurrency} symbol={region.currency.symbol} />
            <span>{localAsset.symbol}</span>
          </span>
        ) : null}
      </div>
      <p className={styles.supportedMore}>Plus other tokens in Home&apos;s supported Base inventory</p>
    </section>
  );
}

function supportedRegionalAsset(
  currency: FiatCurrencyCode | null,
): DirectPortfolioAsset | null {
  if (!currency || currency === "USD") return null;
  const configured = verifiedLocalCashAssets as Partial<
    Record<FiatCurrencyCode, DirectPortfolioAsset>
  >;
  return configured[currency] ?? null;
}

function SignedOutBody() {
  return (
    <div className={modal.body}>
      <p className={styles.subtitle}>
        Sign in and verify a Base account before showing a funding address.
      </p>
    </div>
  );
}
