"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Inline, ListRow, Skeleton, StatusMessage, Text } from "@home/ui";
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
  MoneyModalHeader,
} from "@/client/money-modal";
import modal from "@/client/money-modal/money-modal.module.css";
import styles from "./add-money.module.css";
import { ReceiveQr } from "./receive-qr";
import { FundingOrderFlow, type FundingBinding, type FundingOrderSummary } from "./order-flow";

export type AddMoneyStep = "method" | "receive" | "order";

export function AddMoneyDialog({
  open,
  step,
  address,
  signedOut,
  regionId,
  onClose,
  onBack,
  onSelectReceive,
  providerBindings,
  selectedBinding,
  initialOrder,
  fetchAccountResource,
  queryOwnerKey,
  onSelectBinding,
  onOpenRedirect,
}: {
  open: boolean;
  step: AddMoneyStep;
  address: `0x${string}` | null;
  signedOut: boolean;
  regionId: RegionId;
  onClose: () => void;
  onBack: () => void;
  onSelectReceive: () => void;
  providerBindings: ReadonlyArray<FundingBinding>;
  selectedBinding: FundingBinding | null;
  initialOrder: FundingOrderSummary | null;
  fetchAccountResource: (path: string, options?: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal }) => Promise<unknown>;
  queryOwnerKey?: string | null;
  onSelectBinding: (binding: FundingBinding) => void;
  onOpenRedirect: (url: string) => void;
}) {
  const currency = presentationRegions[regionId].currency.code ?? "USD";
  const title = step === "receive"
    ? "Receive"
    : step === "order"
      ? `Deposit ${selectedBinding?.currency ?? currency}`
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
        onBack={step === "method" || step === "order" ? undefined : onBack}
        onClose={onClose}
        closeLabel="Close add money"
      />

      {signedOut ? <SignedOutBody /> : null}
      {!signedOut && step === "method" ? (
        <MethodBody
          regionId={regionId}
          onSelectReceive={onSelectReceive}
          providerBindings={providerBindings}
          onSelectBinding={onSelectBinding}
        />
      ) : null}
      {!signedOut && step === "receive" ? (
        <ReceiveBody address={address} regionId={regionId} />
      ) : null}
      {!signedOut && step === "order" && selectedBinding ? (
        <FundingOrderFlow
          binding={selectedBinding}
          fetchAccountResource={fetchAccountResource}
          queryOwnerKey={queryOwnerKey}
          onBack={onBack}
          onOpenRedirect={onOpenRedirect}
          initialOrder={initialOrder}
        />
      ) : null}

      {signedOut ? (
        <div className={modal.footer}>
          <Link className={modal.primary} href="/?account=signin">
            Sign in
          </Link>
        </div>
      ) : null}
    </MoneyModal>
  );
}

export function MethodBody({
  regionId,
  onSelectReceive,
  providerBindings,
  onSelectBinding,
}: {
  regionId: RegionId;
  onSelectReceive: () => void;
  providerBindings: ReadonlyArray<FundingBinding>;
  onSelectBinding: (binding: FundingBinding) => void;
}) {
  return (
    <div className={modal.body}>
      <ul className={styles.methods}>
        <ListRow
          className="surface-primary"
          leading={(
            <span className={styles.methodIcon} aria-hidden="true">
              <ArrowDownToLine size={18} strokeWidth={2.1} />
            </span>
          )}
          label="Receive crypto"
          description="USDC and supported tokens on Base"
          actionHint="Open receive options"
          onPress={onSelectReceive}
        />
        {providerBindings.map((binding) => (
          <ListRow
            className="surface-primary"
            key={`${binding.providerId}:${binding.assetId}`}
            leading={(
              <CurrencyMark
                currency={binding.currency as FiatCurrencyCode}
                symbol={presentationRegions[regionId].currency.symbol ?? "$"}
              />
            )}
            label={`Deposit ${binding.currency} with ${binding.displayName}`}
            actionHint="Open deposit flow"
            onPress={() => onSelectBinding(binding)}
          />
        ))}
      </ul>
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
      <Badge className={styles.network} tone="accent">Receive on Base</Badge>
      <div className={styles.qrFrame}>
        {address ? (
          <ReceiveQr value={address} label={`QR code for Base address ${address}`} />
        ) : (
          <Skeleton className={styles.qrShimmer} shape="rectangle" data-shimmer="qr" aria-hidden="true" />
        )}
      </div>
      <div className={styles.addressBlock}>
        {address ? (
          <ReceiveAddress address={address} />
        ) : (
          <>
            <Skeleton
              className={styles.addressShimmer}
              shape="text"
              data-shimmer="address"
              aria-hidden="true"
            />
            <Text className={styles.addressHint} textStyle="metadata" tone="muted">Preparing your Base address</Text>
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
      <Button
        variant="quiet"
        className={styles.addressText}
        title={address}
        aria-label={copyStatus === "copied" ? "Copied" : `Copy ${condensed}`}
        aria-describedby="receive-address-help"
        onClick={() => void copyAddress()}
      >
        {copyStatus === "copied" ? "Copied" : condensed}
      </Button>
      {copyStatus === "error" ? (
        <div className={styles.copyFallback}>
          <StatusMessage id="receive-address-help" tone="error" role="alert">
            Clipboard access is unavailable. Select and copy the full address below.
          </StatusMessage>
          <code
            className={styles.fullAddress}
            aria-label={`Full Base address ${address}`}
            tabIndex={0}
          >
            {address}
          </code>
        </div>
      ) : (
        <Text id="receive-address-help" className={styles.addressHint} textStyle="metadata" tone="muted">
          Tap the address to copy
        </Text>
      )}
    </>
  );
}

export function SupportedAssets({ regionId }: { regionId: RegionId }) {
  const region = presentationRegions[regionId];
  const localAsset = supportedRegionalAsset(region.currency.code);

  return (
    <section className={styles.supported} aria-label="Supported receive assets on Base">
      <Text className={styles.supportedLabel} textStyle="metadata" tone="muted">Supported on Base</Text>
      <Inline className={styles.supportedMarks} space={{ custom: "14px" }}>
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
      </Inline>
      <Text className={styles.supportedMore} textStyle="metadata" tone="muted">Plus other tokens in Home&apos;s supported Base inventory</Text>
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
      <Text className={styles.subtitle} textStyle="secondary" tone="muted">
        Sign in and verify a Base account before showing a funding address.
      </Text>
    </div>
  );
}
