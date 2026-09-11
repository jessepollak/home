"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
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
import type {
  IdrxFundingRail,
  IdrxMintResult,
  IdrxVaChannel,
} from "@/shared/funding/types";
import {
  MoneyModal,
  MoneyModalFooter,
  MoneyModalHeader,
} from "@/client/money-modal";
import modal from "@/client/money-modal/money-modal.module.css";
import styles from "./add-money.module.css";
import { ReceiveQr } from "./receive-qr";

export type AddMoneyStep = "method" | "receive" | "buy" | "idrx";

export function AddMoneyDialog({
  open,
  step,
  address,
  openingOnramp,
  onrampError,
  signedOut,
  regionId,
  idrxResult,
  idrxReturned,
  reconcileRequested,
  onClose,
  onBack,
  onSelectReceive,
  onSelectBuy,
  onSelectIdrx,
  onContinueToCoinbase,
  onCreateIdrx,
  onOpenIdrxCheckout,
  onCheckIdrxFunding,
}: {
  open: boolean;
  step: AddMoneyStep;
  address: `0x${string}` | null;
  openingOnramp: boolean;
  onrampError: string | null;
  signedOut: boolean;
  regionId: RegionId;
  idrxResult: IdrxMintResult | null;
  idrxReturned: boolean;
  reconcileRequested: boolean;
  onClose: () => void;
  onBack: () => void;
  onSelectReceive: () => void;
  onSelectBuy: () => void;
  onSelectIdrx: () => void;
  onContinueToCoinbase: () => void;
  onCreateIdrx: (options: {
    toBeMinted: string;
    rail: IdrxFundingRail;
    channelId?: IdrxVaChannel;
    consent: true;
  }) => void;
  onOpenIdrxCheckout: (url: string) => void;
  onCheckIdrxFunding: () => void;
}) {
  const title = step === "receive"
    ? "Receive"
    : step === "buy"
      ? "Buy"
      : step === "idrx"
        ? "Buy IDRX"
        : "Add money";

  return (
    <MoneyModal open={open} labelledBy="add-money-title" onCancel={onClose} onClose={onClose}>
      <MoneyModalHeader
        title={title}
        titleId="add-money-title"
        onBack={step === "method" ? undefined : onBack}
        onClose={onClose}
        closeLabel="Close add money"
      />

      {signedOut ? <SignedOutBody /> : null}
      {!signedOut && step === "method" ? (
        <MethodBody
          regionId={regionId}
          onSelectReceive={onSelectReceive}
          onSelectBuy={onSelectBuy}
          onSelectIdrx={onSelectIdrx}
        />
      ) : null}
      {!signedOut && step === "receive" ? <ReceiveBody address={address} regionId={regionId} /> : null}
      {!signedOut && step === "buy" ? <BuyBody /> : null}
      {!signedOut && step === "idrx" ? (
        <IdrxBody
          opening={openingOnramp}
          result={idrxResult}
          returned={idrxReturned}
          reconcileRequested={reconcileRequested}
          onCreate={onCreateIdrx}
          onOpenCheckout={onOpenIdrxCheckout}
          onCheckFunding={onCheckIdrxFunding}
        />
      ) : null}

      {onrampError && (step === "buy" || step === "idrx") ? (
        <div className={styles.statusStack}>
          <p className={modal.error} role="alert">{onrampError}</p>
        </div>
      ) : null}

      {signedOut ? (
        <div className={modal.footer}>
          <Link className={modal.primary} href="/?account=signin">Sign in</Link>
        </div>
      ) : null}

      {!signedOut && step === "buy" ? (
        <MoneyModalFooter
          primaryLabel={openingOnramp ? "Opening Coinbase…" : "Continue to Coinbase"}
          primaryDisabled={openingOnramp}
          onPrimary={onContinueToCoinbase}
          secondaryLabel="Back"
          onSecondary={onBack}
        />
      ) : null}
    </MoneyModal>
  );
}

export function MethodBody({
  regionId,
  onSelectReceive,
  onSelectBuy,
  onSelectIdrx,
}: {
  regionId: RegionId;
  onSelectReceive: () => void;
  onSelectBuy: () => void;
  onSelectIdrx: () => void;
}) {
  return (
    <div className={modal.body}>
      <p className={styles.subtitle}>Fund this Base account</p>
      <div className={styles.methods}>
        <MethodButton
          icon={<ArrowDownToLine size={18} strokeWidth={2.1} />}
          title="Receive crypto"
          hint="USDC and supported tokens on Base"
          onClick={onSelectReceive}
        />
        {regionId === "ID" ? (
          <MethodButton
            icon={<CurrencyMark currency="IDR" symbol="Rp" />}
            title="Buy IDRX with rupiah"
            hint="Indonesia bank virtual account or QRIS"
            onClick={onSelectIdrx}
          />
        ) : null}
        <MethodButton
          icon={<CurrencyMark currency="USD" symbol="$" />}
          title="Buy USDC with Coinbase"
          hint="Hosted onramp to Base"
          onClick={onSelectBuy}
        />
      </div>
    </div>
  );
}

function MethodButton({
  icon,
  title,
  hint,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button className={styles.method} type="button" onClick={onClick}>
      <span className={styles.methodIcon} aria-hidden="true">{icon}</span>
      <span className={styles.methodCopy}>
        <span className={styles.methodTitle}>{title}</span>
        <span className={styles.methodHint}>{hint}</span>
      </span>
      <span className={styles.methodChevron} aria-hidden="true">›</span>
    </button>
  );
}

function IdrxBody({
  opening,
  result,
  returned,
  reconcileRequested,
  onCreate,
  onOpenCheckout,
  onCheckFunding,
}: {
  opening: boolean;
  result: IdrxMintResult | null;
  returned: boolean;
  reconcileRequested: boolean;
  onCreate: (options: {
    toBeMinted: string;
    rail: IdrxFundingRail;
    channelId?: IdrxVaChannel;
    consent: true;
  }) => void;
  onOpenCheckout: (url: string) => void;
  onCheckFunding: () => void;
}) {
  const [amount, setAmount] = useState("20000");
  const [rail, setRail] = useState<IdrxFundingRail>("bank-va");
  const [channel, setChannel] = useState<IdrxVaChannel>("MANDIRI");
  const [consent, setConsent] = useState(false);

  if (result || returned) {
    return (
      <div className={`${modal.body} ${styles.idrx}`}>
        <p className={styles.pending} role="status">Funding pending</p>
        {result?.presentation === "virtual-account" ? (
          <dl className={styles.idrxFacts}>
            <div><dt>Bank</dt><dd>{result.channelId}</dd></div>
            <div><dt>Virtual account</dt><dd>{result.virtualAccountNo}</dd></div>
            <div><dt>Account name</dt><dd>{result.virtualAccountName}</dd></div>
            <div><dt>Pay</dt><dd>Rp {result.amount}</dd></div>
            <div><dt>Expires</dt><dd>{result.expiredDate}</dd></div>
          </dl>
        ) : null}
        {result?.presentation === "hosted" ? (
          <button className={modal.primary} type="button" onClick={() => onOpenCheckout(result.url)}>
            Open QRIS checkout
          </button>
        ) : null}
        <p className={styles.verificationCopy}>
          A provider request or payment is not proof of funding. Home verifies IDRX only by refreshing both the smart-account balance and activity.
        </p>
        <button className={modal.secondary} type="button" onClick={onCheckFunding}>
          Check balance &amp; activity
        </button>
        {reconcileRequested ? (
          <p className={styles.reconcileStatus} role="status">
            Balance and activity refresh requested. Funding stays pending until IDRX appears in those reads.
          </p>
        ) : null}
      </div>
    );
  }

  const amountValid = /^(?:[2-9]\d{4}|[1-9]\d{5,8}|1000000000)(?:\.\d{1,2})?$/.test(amount);
  return (
    <form
      className={`${modal.body} ${styles.idrx}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!amountValid || !consent || opening) return;
        onCreate({
          toBeMinted: amount,
          rail,
          ...(rail === "bank-va" ? { channelId: channel } : {}),
          consent: true,
        });
      }}
    >
      <label className={styles.field}>
        <span>Amount in IDR</span>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          aria-invalid={!amountValid}
        />
      </label>
      <fieldset className={styles.railGroup}>
        <legend>Payment method</legend>
        <label><input type="radio" checked={rail === "bank-va"} onChange={() => setRail("bank-va")} /> Bank virtual account</label>
        <label><input type="radio" checked={rail === "qris"} onChange={() => setRail("qris")} /> QRIS checkout</label>
      </fieldset>
      {rail === "bank-va" ? (
        <label className={styles.field}>
          <span>Bank</span>
          <select value={channel} onChange={(event) => setChannel(event.target.value as IdrxVaChannel)}>
            <option value="MANDIRI">Mandiri</option>
            <option value="BRI">BRI</option>
          </select>
        </label>
      ) : null}
      <label className={styles.consent}>
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
        <span>I consent to IDRX receiving this amount and my Base destination. IDRX may require issuer KYC before payment.</span>
      </label>
      <button className={modal.primary} type="submit" disabled={!amountValid || !consent || opening}>
        {opening ? "Creating request…" : rail === "qris" ? "Continue to QRIS" : "Create virtual account"}
      </button>
    </form>
  );
}

export function ReceiveBody({ address, regionId }: { address: `0x${string}` | null; regionId: RegionId }) {
  return (
    <div className={`${modal.body} ${styles.receive}`}>
      <p className={styles.network}>Receive on Base</p>
      <div className={styles.qrFrame}>
        {address ? <ReceiveQr value={address} label={`QR code for Base address ${address}`} /> : <span className={`shimmer ${styles.qrShimmer}`} data-shimmer="qr" aria-hidden="true" />}
      </div>
      <div className={styles.addressBlock}>
        {address ? <ReceiveAddress address={address} /> : <><span className={`shimmer ${styles.addressShimmer}`} data-shimmer="address" aria-hidden="true" /><p className={styles.addressHint}>Preparing your Base address</p></>}
      </div>
      <SupportedAssets regionId={regionId} />
    </div>
  );
}

function ReceiveAddress({ address }: { address: `0x${string}` }) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const condensed = formatAddress(address);
  async function copyAddress() {
    if (!navigator.clipboard?.writeText) return setCopyStatus("error");
    try { await navigator.clipboard.writeText(address); setCopyStatus("copied"); }
    catch { setCopyStatus("error"); }
  }
  return (
    <>
      <button type="button" className={styles.addressText} title={address} aria-label={copyStatus === "copied" ? "Copied" : `Copy ${condensed}`} aria-describedby="receive-address-help" onClick={() => void copyAddress()}>
        {copyStatus === "copied" ? "Copied" : condensed}
      </button>
      {copyStatus === "error" ? (
        <div className={styles.copyFallback}>
          <p id="receive-address-help" className={styles.copyError} role="alert">Clipboard access is unavailable. Select and copy the full address below.</p>
          <code className={styles.fullAddress} aria-label={`Full Base address ${address}`} tabIndex={0}>{address}</code>
        </div>
      ) : <p id="receive-address-help" className={styles.addressHint}>Tap the address to copy</p>}
    </>
  );
}

export function BuyBody() {
  return (
    <div className={`${modal.body} ${styles.buy}`}>
      <CurrencyMark currency="USD" symbol="$" />
      <h3 className={styles.buyTitle}>Continue to Coinbase</h3>
      <p className={styles.buyLead}>Buy USDC with Coinbase&apos;s hosted onramp and receive it on Base.</p>
    </div>
  );
}

export function SupportedAssets({ regionId }: { regionId: RegionId }) {
  const region = presentationRegions[regionId];
  const localAsset = supportedRegionalAsset(region.currency.code);
  return (
    <section className={styles.supported} aria-label="Supported receive assets on Base">
      <p className={styles.supportedLabel}>Supported on Base</p>
      <div className={styles.supportedMarks}>
        <span className={styles.supportedAsset}><CurrencyMark currency="USD" symbol="$" /><span>USDC</span></span>
        {localAsset ? <span className={styles.supportedAsset}><CurrencyMark currency={localAsset.cashCurrency} symbol={region.currency.symbol} /><span>{localAsset.symbol}</span></span> : null}
      </div>
      <p className={styles.supportedMore}>Plus other tokens in Home&apos;s supported Base inventory</p>
    </section>
  );
}

function supportedRegionalAsset(currency: FiatCurrencyCode | null): DirectPortfolioAsset | null {
  if (!currency || currency === "USD") return null;
  const configured = verifiedLocalCashAssets as Partial<Record<FiatCurrencyCode, DirectPortfolioAsset>>;
  return configured[currency] ?? null;
}

function SignedOutBody() {
  return <div className={modal.body}><p className={styles.subtitle}>Sign in and verify a Base account before showing a funding address.</p></div>;
}
