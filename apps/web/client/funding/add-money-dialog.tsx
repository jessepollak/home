"use client";

import Link from "next/link";
import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Alert, AlertAction, AlertIcon, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { CircleAlertIcon, ArrowDownToLine, ChevronRight, Landmark } from "lucide-react";
import { CurrencyMark } from "@/components/currency-mark";
import { verifiedLocalCashAsset, type DirectPortfolioAsset } from "@/config/portfolio-assets";
import {
  presentationRegions,
  type FiatCurrencyCode,
  type RegionId,
} from "@/config/regions";
import { formatAddress } from "@/shared/formatting";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import type { FundingProviderCustomerSummary } from "@/shared/funding/contracts/provider-customers";
import { receiveSupportedCashCurrencies } from "@/shared/funding/assets";
import { MoneyModal, MoneyModalActions, MoneyModalBody, MoneyModalHeader, MoneyModalStep } from "@/client/money-modal";
import { MethodShimmerRow } from "./method-skeleton";
import { ReceiveQr } from "./receive-qr";
import {
  FundingOrderFlow,
  OpenOrderPrompt,
  type FundingBinding,
  type FundingOrderSummary,
} from "./order-flow";

export type AddMoneyStep = "method" | "receive" | "open-order" | "order";
export type ProvidersStatus = "unavailable" | "loading" | "loaded" | "failed";

export function AddMoneyDialog({
  open,
  step,
  address,
  signedOut,
  regionId,
  onClose,
  onClosed,
  onBack,
  onSelectReceive,
  providerBindings,
  providersStatus,
  providerBindingsDisabled,
  customerSetupReady,
  resumableBinding,
  fundingReadError,
  selectedBinding,
  initialOrder,
  promptOrder,
  onContinueOrder,
  onStartNewOrder,
  startNewAllowed,
  initialCustomer,
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
  onClosed?: () => void;
  onBack: () => void;
  onSelectReceive: () => void;
  providerBindings: ReadonlyArray<FundingBinding>;
  providersStatus: ProvidersStatus;
  providerBindingsDisabled: boolean;
  customerSetupReady: boolean;
  resumableBinding: (binding: FundingBinding) => boolean;
  fundingReadError: { message: string; retry: () => void } | null;
  selectedBinding: FundingBinding | null;
  initialOrder: FundingOrderSummary | null;
  promptOrder: FundingOrderSummary | null;
  onContinueOrder: () => void;
  onStartNewOrder: () => void;
  startNewAllowed: boolean;
  initialCustomer?: FundingProviderCustomerSummary | null;
  fetchAccountResource: AccountWalletClient["fetchAccountResource"];
  queryOwnerKey?: string | null;
  onSelectBinding: (binding: FundingBinding) => void;
  onOpenRedirect: (url: string) => void;
}) {
  const currency = presentationRegions[regionId].currency.code ?? "USD";
  const title =
    step === "receive"
      ? "Receive"
      : step === "order" || step === "open-order"
        ? `Deposit ${selectedBinding?.currency ?? currency}`
        : "Add money";

  return (
    <MoneyModal
      open={open}
      labelledBy="add-money-title"
      onCancel={onClose}
      onClose={() => onClosed?.()}
    >
      {step !== "order" || signedOut ? (
        <MoneyModalStep step={signedOut ? "signed-out" : step} depth={!signedOut && (step === "receive" || step === "open-order") ? 1 : 0}>
        <MoneyModalHeader
          title={title}
          titleId="add-money-title"
          onBack={step === "method" || step === "order" ? undefined : onBack}
          closeLabel="Close add money"
        />

      {signedOut ? <SignedOutBody /> : null}
      {!signedOut && step === "method" ? (
        <MethodBody
          onSelectReceive={onSelectReceive}
          providerBindings={providerBindings}
          providersStatus={providersStatus}
          countryName={presentationRegions[regionId].countryName}
          providerBindingsDisabled={providerBindingsDisabled}
          customerSetupReady={customerSetupReady}
          resumableBinding={resumableBinding}
          fundingReadError={fundingReadError}
          onSelectBinding={onSelectBinding}
        />
      ) : null}
      {!signedOut && step === "receive" ? (
        <ReceiveBody address={address} regionId={regionId} />
      ) : null}
      {!signedOut && step === "open-order" && selectedBinding && promptOrder ? (
        <OpenOrderPrompt
          binding={selectedBinding}
          order={promptOrder}
          startNewAllowed={startNewAllowed && (selectedBinding.direction !== "onramp" || selectedBinding.resumeOnly !== true)}
          onContinue={onContinueOrder}
          onStartNew={onStartNewOrder}
        />
      ) : null}
      {signedOut ? (
        <MoneyModalActions>
          <Link
            className={buttonVariants({ size: "touch" })}
            href="/?account=signin"
          >
            Sign in
          </Link>
        </MoneyModalActions>
      ) : null}
        </MoneyModalStep>
      ) : null}
      {!signedOut && step === "order" && selectedBinding ? (
        <FundingOrderFlow
          binding={selectedBinding}
          fetchAccountResource={fetchAccountResource}
          queryOwnerKey={queryOwnerKey}
          titleId="add-money-title"
          onBack={onBack}
          onOpenRedirect={onOpenRedirect}
          initialOrder={initialOrder}
          initialCustomer={initialCustomer}
        />
      ) : null}
    </MoneyModal>
  );
}

export function MethodBody({
  onSelectReceive,
  providerBindings,
  providersStatus,
  countryName,
  providerBindingsDisabled,
  customerSetupReady,
  resumableBinding,
  fundingReadError,
  onSelectBinding,
}: {
  onSelectReceive: () => void;
  providerBindings: ReadonlyArray<FundingBinding>;
  providersStatus: ProvidersStatus;
  countryName: string;
  providerBindingsDisabled: boolean;
  customerSetupReady: boolean;
  resumableBinding: (binding: FundingBinding) => boolean;
  fundingReadError: { message: string; retry: () => void } | null;
  onSelectBinding: (binding: FundingBinding) => void;
}) {
  const statusRef = useRef<HTMLSpanElement>(null);
  const statusMessage = providersStatus === "loading"
    ? "Loading deposit methods"
    : providersStatus === "loaded" && !fundingReadError && providerBindings.length === 0
      ? `No local deposit method in ${countryName} yet.`
      : "";

  useEffect(() => {
    if (statusRef.current) statusRef.current.textContent = statusMessage;
  }, [statusMessage]);

  return (
    <MoneyModalBody hasFooter={false} className="pt-4">
      {fundingReadError ? (
        <Alert variant="destructive">
          <AlertIcon><CircleAlertIcon /></AlertIcon>
          <AlertDescription>{fundingReadError.message}</AlertDescription>
          <AlertAction>
            <Button variant="outline" size="touch" onClick={fundingReadError.retry}>Retry</Button>
          </AlertAction>
        </Alert>
      ) : null}
      <span ref={statusRef} role="status" className="sr-only" />
      <Card variant="flush">
        <CardContent inset="list">
          <div aria-busy={providersStatus === "loading"} className="@container/method-list">
            <MethodRow
              icon={<ArrowDownToLine className="size-4" />}
              title="Receive crypto"
              description="USDC and supported tokens on Base"
              hint="Open receive options"
              onSelect={onSelectReceive}
            />
            {providersStatus === "loading" ? (
              <>
                <ItemSeparator className="my-0" />
                <MethodShimmerRow />
              </>
            ) : null}
            {providerBindings.map((binding) => (
              <Fragment key={`${binding.providerId}:${binding.assetId}`}>
                <ItemSeparator className="my-0" />
                <MethodRow
                  icon={<Landmark className="size-4" />}
                  title={`Deposit ${binding.currency}`}
                  description={fundingMethodDescription(binding)}
                  hint="Open deposit flow"
                  disabled={
                    providerBindingsDisabled ||
                    (binding.customerSetup !== null && !customerSetupReady && !resumableBinding(binding) &&
                      !(binding.direction === "onramp" && binding.resumeOnly === true))
                  }
                  onSelect={() => onSelectBinding(binding)}
                />
              </Fragment>
            ))}
          </div>
        </CardContent>
      </Card>
      {providersStatus === "loaded" && !fundingReadError && providerBindings.length === 0 ? (
        // oxlint-disable-next-line jsx-a11y/aria-role -- Removes Alert's live role from an aria-hidden visual duplicate of the status message.
        <Alert role={undefined} aria-hidden="true">
          <AlertDescription>No local deposit method in {countryName} yet.</AlertDescription>
        </Alert>
      ) : null}
    </MoneyModalBody>
  );
}

function MethodRow({
  icon,
  title,
  description,
  hint,
  disabled,
  onSelect,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  hint: string;
  disabled?: boolean;
  onSelect: () => void;
}) {
  const hintId = useId();

  return (
    <Item
      render={
        <Button
          variant="ghost"
          press="none"
          type="button"
          disabled={disabled}
          onClick={onSelect}
          aria-describedby={hintId}
        />
      }
      className="h-auto flex-nowrap items-center justify-start text-start whitespace-normal"
    >
      <ItemMedia variant="avatar">{icon}</ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle truncate="wrap">{title}</ItemTitle>
        <ItemDescription lines="wrap">{description}</ItemDescription>
        <span id={hintId} hidden>{hint}</span>
      </ItemContent>
      <ItemActions aria-hidden="true" className="@max-[12rem]/method-list:hidden">
        <ChevronRight className="size-4 text-muted-foreground rtl:-scale-x-100" />
      </ItemActions>
    </Item>
  );
}

function fundingMethodDescription(binding: FundingBinding): string {
  const labels = binding.paymentMethods
    .map((method) => method.label)
    .filter((label) => label !== binding.displayName);
  const methods = labels.slice(0, 2);
  const remaining = labels.length - methods.length;
  return [
    binding.displayName,
    ...methods,
    ...(remaining > 0 ? [`+${remaining}`] : []),
  ].join(" · ");
}

export function ReceiveBody({
  address,
  regionId,
}: {
  address: `0x${string}` | null;
  regionId: RegionId;
}) {
  return (
    <MoneyModalBody hasFooter={false} className="items-center gap-4 pt-2">
      <Badge variant="secondary">Receive on Base</Badge>
      <div className="aspect-square w-full max-w-56 overflow-hidden rounded-xl border bg-background">
        {address ? (
          <ReceiveQr
            value={address}
            label={`QR code for Base address ${address}`}
          />
        ) : (
          <Skeleton
            className="size-full"
            data-shimmer="qr"
            aria-hidden="true"
          />
        )}
      </div>
      <div className="grid justify-items-center gap-1 text-center">
        {address ? (
          <ReceiveAddress address={address} />
        ) : (
          <>
            <Skeleton
              className="h-4 w-36"
              data-shimmer="address"
              aria-hidden="true"
            />
            <p className="text-center text-xs text-muted-foreground">
              Preparing your Base address
            </p>
          </>
        )}
      </div>
      <SupportedAssets regionId={regionId} />
    </MoneyModalBody>
  );
}

function ReceiveAddress({ address }: { address: `0x${string}` }) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">(
    "idle",
  );
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
        variant="ghost"
        className="select-text"
        size="touch"
        title={address}
        aria-label={copyStatus === "copied" ? "Copied" : `Copy ${condensed}`}
        aria-describedby="receive-address-help"
        onClick={() => void copyAddress()}
      >
        {copyStatus === "copied" ? "Copied" : condensed}
      </Button>
      {copyStatus === "error" ? (
        <div className="grid w-full max-w-xs justify-items-center gap-2">
          <Alert id="receive-address-help" variant="destructive" role="alert">
            <AlertIcon><CircleAlertIcon /></AlertIcon>
            <AlertDescription>
              Clipboard access is unavailable. Select and copy the full address
              below.
            </AlertDescription>
          </Alert>
          <code
            className="block w-full select-text rounded-lg border bg-muted p-3 font-mono text-xs [overflow-wrap:anywhere]"
            aria-label={`Full Base address ${address}`}
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Focusable full address supports keyboard selection.
            tabIndex={0}
          >
            {address}
          </code>
        </div>
      ) : (
        <p
          id="receive-address-help"
          className="text-center text-xs text-muted-foreground"
        >
          Tap the address to copy
        </p>
      )}
    </>
  );
}

export function SupportedAssets({ regionId }: { regionId: RegionId }) {
  const region = presentationRegions[regionId];
  const localAsset = supportedRegionalAsset(region.currency.code);

  return (
    <section
      className="grid w-full justify-items-center gap-3 border-t pt-4"
      aria-label="Supported receive assets on Base"
    >
      <p className="text-xs font-medium text-muted-foreground">
        Supported on Base
      </p>
      <div className="flex items-center justify-center gap-4">
        <span className="inline-flex items-center gap-2 text-sm font-medium">
          <CurrencyMark currency="USD" symbol="$" />
          <span>USDC</span>
        </span>
        {localAsset ? (
          <span className="inline-flex items-center gap-2 text-sm font-medium">
            <CurrencyMark
              currency={localAsset.cashCurrency}
              symbol={region.currency.symbol}
            />
            <span>{localAsset.symbol}</span>
          </span>
        ) : null}
      </div>
      <p className="max-w-sm text-center text-xs text-muted-foreground">
        Plus other tokens in Home&apos;s supported Base inventory
      </p>
    </section>
  );
}

function supportedRegionalAsset(
  currency: FiatCurrencyCode | null,
): DirectPortfolioAsset | null {
  if (!currency || !receiveSupportedCashCurrencies.some((supported) => supported === currency)) return null;
  return verifiedLocalCashAsset(currency);
}

function SignedOutBody() {
  return (
    <MoneyModalBody hasFooter className="pt-4">
      <p className="text-sm text-muted-foreground">
        Sign in and verify a Base account before showing a funding address.
      </p>
    </MoneyModalBody>
  );
}
