"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DrawerFooter } from "@/components/ui/drawer";
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
import { ArrowDownToLine, ChevronRight, Landmark } from "lucide-react";
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
import { MoneyModal, MoneyModalBody, MoneyModalHeader } from "@/client/money-modal";
import { ReceiveQr } from "./receive-qr";
import {
  FundingOrderFlow,
  type FundingBinding,
  type FundingOrderSummary,
} from "./order-flow";

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
  providerBindingsDisabled,
  fundingReadError,
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
  providerBindingsDisabled: boolean;
  fundingReadError: { message: string; retry: () => void } | null;
  selectedBinding: FundingBinding | null;
  initialOrder: FundingOrderSummary | null;
  fetchAccountResource: (
    path: string,
    options?: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal },
  ) => Promise<unknown>;
  queryOwnerKey?: string | null;
  onSelectBinding: (binding: FundingBinding) => void;
  onOpenRedirect: (url: string) => void;
}) {
  const currency = presentationRegions[regionId].currency.code ?? "USD";
  const title =
    step === "receive"
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
          onSelectReceive={onSelectReceive}
          providerBindings={providerBindings}
          providerBindingsDisabled={providerBindingsDisabled}
          fundingReadError={fundingReadError}
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
        <DrawerFooter>
          <Link
            className={buttonVariants({ size: "lg", className: "h-11" })}
            href="/?account=signin"
          >
            Sign in
          </Link>
        </DrawerFooter>
      ) : null}
    </MoneyModal>
  );
}

export function MethodBody({
  onSelectReceive,
  providerBindings,
  providerBindingsDisabled,
  fundingReadError,
  onSelectBinding,
}: {
  onSelectReceive: () => void;
  providerBindings: ReadonlyArray<FundingBinding>;
  providerBindingsDisabled: boolean;
  fundingReadError: { message: string; retry: () => void } | null;
  onSelectBinding: (binding: FundingBinding) => void;
}) {
  return (
    <MoneyModalBody className="pt-4">
      {fundingReadError ? (
        <Alert variant="destructive">
          <AlertDescription>{fundingReadError.message}</AlertDescription>
          <AlertAction>
            <Button variant="ghost" onClick={fundingReadError.retry}>Retry</Button>
          </AlertAction>
        </Alert>
      ) : null}
      <Card>
        <CardContent inset="list">
          <div>
            <Item
              render={
                <Button
                  variant="ghost"
                  type="button"
                  onClick={onSelectReceive}
                  aria-describedby="receive-method-hint"
                />
              }
              className="min-h-16 flex-nowrap items-center"
            >
              <ItemMedia variant="avatar">
                <ArrowDownToLine className="size-4" />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle>Receive crypto</ItemTitle>
                <ItemDescription>USDC and supported tokens on Base</ItemDescription>
                <span id="receive-method-hint" hidden>Open receive options</span>
              </ItemContent>
              <ItemActions aria-hidden="true">
                <ChevronRight className="size-4 text-muted-foreground" />
              </ItemActions>
            </Item>
            {providerBindings.map((binding) => (
              <Fragment key={`${binding.providerId}:${binding.assetId}`}>
                <ItemSeparator className="my-0" />
                <Item
                  render={
                    <Button
                      variant="ghost"
                      type="button"
                      disabled={providerBindingsDisabled}
                      onClick={() => onSelectBinding(binding)}
                      aria-describedby={`funding-method-${binding.providerId}-${binding.assetId}`}
                    />
                  }
                  className="min-h-16 flex-nowrap items-center"
                >
                  <ItemMedia variant="avatar">
                    <Landmark className="size-4" />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle>{`Deposit ${binding.currency}`}</ItemTitle>
                    <ItemDescription>{fundingMethodDescription(binding)}</ItemDescription>
                    <span id={`funding-method-${binding.providerId}-${binding.assetId}`} hidden>Open deposit flow</span>
                  </ItemContent>
                  <ItemActions aria-hidden="true">
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </ItemActions>
                </Item>
              </Fragment>
            ))}
          </div>
        </CardContent>
      </Card>
    </MoneyModalBody>
  );
}

function fundingMethodDescription(binding: FundingBinding): string {
  // A method labelled like the provider itself ("Coinbase · Coinbase") says nothing twice.
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
    <MoneyModalBody className="items-center gap-4 pt-2">
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
        size="lg"
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
            <AlertDescription>
              Clipboard access is unavailable. Select and copy the full address
              below.
            </AlertDescription>
          </Alert>
          <code
            className="block w-full select-text rounded-lg border bg-muted p-3 font-mono text-xs [overflow-wrap:anywhere]"
            aria-label={`Full Base address ${address}`}
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
  if (!currency || currency === "USD") return null;
  const configured = verifiedLocalCashAssets as Partial<
    Record<FiatCurrencyCode, DirectPortfolioAsset>
  >;
  return configured[currency] ?? null;
}

function SignedOutBody() {
  return (
    <MoneyModalBody className="pt-4">
      <p className="text-sm text-muted-foreground">
        Sign in and verify a Base account before showing a funding address.
      </p>
    </MoneyModalBody>
  );
}
