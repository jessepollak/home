"use client";

import Link from "next/link";
import { useState } from "react";
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
import { ripioAvailability } from "@/shared/funding/ripio-contract";
import {
  MoneyModal,
  MoneyModalFooter,
  MoneyModalHeader,
} from "@/client/money-modal";
import modal from "@/client/money-modal/money-modal.module.css";
import styles from "./add-money.module.css";
import { ReceiveQr } from "./receive-qr";

export type AddMoneyStep = "method" | "receive" | "buy" | "ripio" | "onramps";

export function AddMoneyDialog({
  open,
  step,
  address,
  openingOnramp,
  onrampError,
  signedOut,
  regionId,
  onClose,
  onBack,
  onSelectReceive,
  onSelectBuy,
  onSelectRipio,
  onSelectAnotherOnramp,
  onContinueToCoinbase,
}: {
  open: boolean;
  step: AddMoneyStep;
  address: `0x${string}` | null;
  openingOnramp: boolean;
  onrampError: string | null;
  signedOut: boolean;
  regionId: RegionId;
  onClose: () => void;
  onBack: () => void;
  onSelectReceive: () => void;
  onSelectBuy: () => void;
  onSelectRipio: () => void;
  onSelectAnotherOnramp: () => void;
  onContinueToCoinbase: () => void;
}) {
  const currency = presentationRegions[regionId].currency.code ?? "USD";
  const title =
    step === "receive"
      ? "Receive"
      : step === "buy"
        ? "Deposit USD"
        : step === "ripio"
          ? `Deposit ${currency}`
          : step === "onramps"
            ? "Choose another onramp"
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
          onSelectRipio={onSelectRipio}
          onSelectAnotherOnramp={onSelectAnotherOnramp}
        />
      ) : null}
      {!signedOut && step === "receive" ? (
        <ReceiveBody address={address} regionId={regionId} />
      ) : null}
      {!signedOut && step === "buy" ? <BuyBody /> : null}
      {!signedOut && step === "ripio" ? <RipioBody regionId={regionId} /> : null}
      {!signedOut && step === "onramps" ? (
        <OtherOnrampsBody
          regionId={regionId}
          onSelectCoinbase={onSelectBuy}
        />
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
          primaryLabel={openingOnramp ? "Opening Coinbase…" : "Continue to Coinbase"}
          primaryDisabled={openingOnramp}
          onPrimary={onContinueToCoinbase}
          secondaryLabel="Back"
          onSecondary={onBack}
        />
      ) : null}
      {!signedOut && (step === "ripio" || step === "onramps") ? (
        <div className={modal.footer}>
          <button className={modal.quiet} type="button" onClick={onBack}>Back</button>
        </div>
      ) : null}
    </MoneyModal>
  );
}

export function MethodBody({
  regionId,
  onSelectReceive,
  onSelectBuy,
  onSelectRipio,
  onSelectAnotherOnramp,
}: {
  regionId: RegionId;
  onSelectReceive: () => void;
  onSelectBuy: () => void;
  onSelectRipio: () => void;
  onSelectAnotherOnramp: () => void;
}) {
  const ripio = ripioAvailability(regionId);
  const localCurrency = presentationRegions[regionId].currency.code ?? "USD";
  const showRipio = regionId === "AR" || regionId === "CO" || regionId === "BR";
  const showCoinbase = regionId === "US";
  return (
    <div className={modal.body}>
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
        {ripio && showRipio ? (
          <button
            className={styles.method}
            type="button"
            onClick={onSelectRipio}
          >
            <CurrencyMark
              currency={localCurrency}
              symbol={presentationRegions[regionId].currency.symbol ?? "$"}
            />
            <span className={styles.methodCopy}>
              <span className={styles.methodTitle}>
                {ripio.available ? `Deposit ${localCurrency}` : "Ripio unavailable"}
              </span>
              <span className={styles.methodHint}>
                {ripio.available
                  ? "Use Ripio to deposit from your local bank"
                  : "Brazil route unavailable until the supported asset is selected"}
              </span>
            </span>
            <span className={styles.methodChevron} aria-hidden="true">›</span>
          </button>
        ) : null}
        {showCoinbase ? (
          <button className={styles.method} type="button" onClick={onSelectBuy}>
            <CurrencyMark currency="USD" symbol="$" />
            <span className={styles.methodCopy}>
              <span className={styles.methodTitle}>Deposit USD</span>
              <span className={styles.methodHint}>Use Coinbase to deposit USD</span>
            </span>
            <span className={styles.methodChevron} aria-hidden="true">›</span>
          </button>
        ) : null}
      </div>
      <button
        className={styles.anotherOnramp}
        type="button"
        onClick={onSelectAnotherOnramp}
      >
        Use another onramp
      </button>
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

export function BuyBody() {
  return (
    <div className={`${modal.body} ${styles.buy}`}>
      <CurrencyMark currency="USD" symbol="$" />
      <h3 className={styles.buyTitle}>Use Coinbase to deposit USD</h3>
      <p className={styles.buyLead}>
        Continue to Coinbase&apos;s hosted onramp to deposit into this account.
      </p>
    </div>
  );
}

type RipioPreviewStage =
  | "requirements"
  | "quote"
  | "rail"
  | "pending"
  | "recovery"
  | "refund"
  | "error";

const ripioPreviewStages: readonly RipioPreviewStage[] = [
  "requirements",
  "quote",
  "rail",
  "pending",
  "recovery",
  "refund",
  "error",
];

export function RipioBody({ regionId }: { regionId: RegionId }) {
  const availability = ripioAvailability(regionId);
  const [stage, setStage] = useState<RipioPreviewStage>("requirements");
  if (!availability) return null;
  const region = presentationRegions[regionId];
  const localCurrency = region.currency.code ?? "USD";

  if (!availability.available) {
    return (
      <div className={`${modal.body} ${styles.buy}`}>
        <CurrencyMark currency={localCurrency} symbol={region.currency.symbol ?? "$"} />
        <h3 className={styles.buyTitle}>Use Ripio to deposit from your local bank</h3>
        <p className={styles.buyLead}>
          Ripio does not currently expose Home&apos;s selected BRZ asset on Base. No Brazil
          order can be created until the Brazil asset decision is resolved.
        </p>
      </div>
    );
  }

  const index = ripioPreviewStages.indexOf(stage);
  const previous = index > 0 ? ripioPreviewStages[index - 1] : null;
  const next = index < ripioPreviewStages.length - 1
    ? ripioPreviewStages[index + 1]
    : null;

  return (
    <div className={`${modal.body} ${styles.ripioFlow}`}>
      <div className={styles.ripioIntro}>
        <CurrencyMark currency={localCurrency} symbol={region.currency.symbol ?? "$"} />
        <div>
          <h3 className={styles.ripioTitle}>Use Ripio to deposit from your local bank</h3>
          <p className={styles.previewNote}>Synthetic preview · no order or funds</p>
        </div>
      </div>
      <p className={styles.previewProgress} aria-live="polite">
        Step {index + 1} of {ripioPreviewStages.length}
      </p>
      <RipioPreviewStageBody stage={stage} currency={localCurrency} regionId={regionId} />
      <div className={styles.previewActions}>
        {next ? (
          <button className={modal.primary} type="button" onClick={() => setStage(next)}>
            {ripioPreviewNextLabel(next)}
          </button>
        ) : (
          <button
            className={modal.primary}
            type="button"
            onClick={() => setStage("requirements")}
          >
            Restart preview
          </button>
        )}
        {previous ? (
          <button className={modal.quiet} type="button" onClick={() => setStage(previous)}>
            Previous preview step
          </button>
        ) : null}
      </div>
    </div>
  );
}

function RipioPreviewStageBody({
  stage,
  currency,
  regionId,
}: {
  stage: RipioPreviewStage;
  currency: FiatCurrencyCode;
  regionId: RegionId;
}) {
  if (stage === "requirements") {
    return (
      <section className={styles.previewCard} aria-label="Requirements and verification">
        <h4 className={styles.previewTitle}>Requirements</h4>
        <PreviewRow label="Ripio terms and consent" value="Required; not accepted in preview" />
        <PreviewRow label="Identity verification" value="Required; not checked in preview" />
        <PreviewRow label="Base destination" value="Locked to this verified account" />
      </section>
    );
  }
  if (stage === "quote") {
    return (
      <section className={styles.previewCard} aria-label="Quote review">
        <h4 className={styles.previewTitle}>Review quote</h4>
        <PreviewRow label="Deposit" value={`Entered in ${currency}`} />
        <PreviewRow label="Fees and amount received" value="Locked from Ripio's quote" />
        <PreviewRow label="Quote expiry" value="Checked again before order creation" />
      </section>
    );
  }
  if (stage === "rail") {
    return (
      <section className={styles.previewCard} aria-label="Bank rail instructions">
        <h4 className={styles.previewTitle}>Bank instructions</h4>
        <PreviewRow
          label="Payment rail"
          value={regionId === "AR" ? "ARS bank transfer" : "COP bank transfer or approved rail"}
        />
        <PreviewRow label="Account and reference" value="Shown only from the bound Ripio order" />
        <p className={styles.previewHelp}>Never send funds using preview instructions.</p>
      </section>
    );
  }
  if (stage === "pending") {
    return (
      <section className={styles.previewCard} aria-label="Pending deposit">
        <h4 className={styles.previewTitle}>Waiting for your bank transfer</h4>
        <PreviewRow label="Order state" value="Awaiting payment" />
        <PreviewRow label="Delivery" value="Not complete until exact Base receipt evidence matches" />
      </section>
    );
  }
  if (stage === "recovery") {
    return (
      <section className={styles.previewCard} aria-label="Deposit recovery">
        <h4 className={styles.previewTitle}>Recovering a delayed update</h4>
        <PreviewRow label="Provider lookup" value="Retrying the exact country-scoped order" />
        <PreviewRow label="Safety" value="Ambiguous matches stay pending for review" />
      </section>
    );
  }
  if (stage === "refund") {
    return (
      <section className={styles.previewCard} aria-label="Refund status">
        <h4 className={styles.previewTitle}>Refund status</h4>
        <PreviewRow label="Refund" value="Pending until Ripio confirms the outcome" />
        <PreviewRow label="Deposit" value="Never marked received from a refund event" />
      </section>
    );
  }
  return (
    <section className={styles.previewCard} aria-label="Provider error">
      <h4 className={styles.previewTitle}>Deposit unavailable</h4>
      <PreviewRow label="Order" value="Not created or left pending safely" />
      <PreviewRow label="Next step" value="Retry later; no duplicate request is sent" />
      <p className={styles.previewError} role="alert">
        Ripio could not confirm this synthetic request.
      </p>
    </section>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.previewRow}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ripioPreviewNextLabel(stage: RipioPreviewStage): string {
  if (stage === "quote") return "Preview quote";
  if (stage === "rail") return "Preview bank instructions";
  if (stage === "pending") return "Preview pending deposit";
  if (stage === "recovery") return "Preview recovery";
  if (stage === "refund") return "Preview refund";
  return "Preview error state";
}

type OtherOnramp = {
  id: string;
  provider: "Coinbase" | "Ripio";
  currency: "USD" | "ARS" | "COP" | "BRL";
  regionId: "US" | "AR" | "CO" | "BR";
};

const otherOnramps: readonly OtherOnramp[] = [
  { id: "coinbase-usd", provider: "Coinbase", currency: "USD", regionId: "US" },
  { id: "ripio-ars", provider: "Ripio", currency: "ARS", regionId: "AR" },
  { id: "ripio-cop", provider: "Ripio", currency: "COP", regionId: "CO" },
  { id: "ripio-brl", provider: "Ripio", currency: "BRL", regionId: "BR" },
];

export function OtherOnrampsBody({
  regionId,
  onSelectCoinbase,
}: {
  regionId: RegionId;
  onSelectCoinbase: () => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = otherOnramps.filter((onramp) => {
    if (onramp.regionId === regionId) return false;
    return `${onramp.provider} ${onramp.currency}`
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  });

  return (
    <div className={modal.body}>
      <label className={styles.searchLabel} htmlFor="other-onramp-search">
        Search onramps
      </label>
      <input
        id="other-onramp-search"
        className={styles.searchInput}
        type="search"
        value={query}
        placeholder="Provider or currency"
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      <div className={styles.otherOnramps} aria-live="polite">
        {matches.map((onramp) => {
          const canOpen = onramp.provider === "Coinbase";
          const region = presentationRegions[onramp.regionId];
          const content = (
            <>
              <CurrencyMark currency={onramp.currency} symbol={region.currency.symbol ?? "$"} />
              <span className={styles.methodCopy}>
                <span className={styles.methodTitle}>
                  Use {onramp.provider} to deposit {onramp.currency}
                </span>
                <span className={styles.methodHint}>
                  {canOpen
                    ? "Available without changing your saved country"
                    : "Unavailable for your selected country"}
                </span>
              </span>
              {canOpen ? (
                <span className={styles.methodChevron} aria-hidden="true">›</span>
              ) : null}
            </>
          );
          return canOpen ? (
            <button
              className={styles.method}
              type="button"
              onClick={onSelectCoinbase}
              key={onramp.id}
            >
              {content}
            </button>
          ) : (
            <div className={`${styles.method} ${styles.unavailableMethod}`} key={onramp.id}>
              {content}
            </div>
          );
        })}
        {matches.length === 0 ? (
          <p className={styles.noOnramps}>No onramps match your search.</p>
        ) : null}
      </div>
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
