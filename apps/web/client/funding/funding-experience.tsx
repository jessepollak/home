"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RegionId } from "@/config/regions";
import { useAccountWallet, type AccountWalletClient } from "@/client/account/cdp-client";
import { activityOwnerKey } from "@/client/activity/use-activity";
import {
  AddMoneyDialog,
  type AddMoneyStep,
} from "./add-money-dialog";
import { readFundingOrder, type FundingBinding, type FundingOrderSummary } from "./order-flow";
import { ownerQueryKey, ownerQueryMeta, useHomeQuery } from "@/client/query/query-client";
import { requestHostedOnrampSession, FundingRequestError } from "@/shared/funding/funding-client";

export type FundingExperienceProps = {
  returnedFromCoinbase?: boolean;
  open?: boolean;
  onClose?: () => void;
  initialStep?: AddMoneyStep;
  onStepChange?: (step: AddMoneyStep) => void;
  regionId?: RegionId;
};

type FundingWallet = Pick<
  AccountWalletClient,
  "ownerKey" | "status" | "session" | "fetchAccountResource"
>;

export function FundingExperience(props: FundingExperienceProps) {
  const wallet = useAccountWallet();
  return (
    <FundingExperienceForWallet
      {...props}
      wallet={wallet}
      navigateToHostedOnramp={(url) => window.location.assign(url)}
    />
  );
}

type FundingExperienceForWalletProps = FundingExperienceProps & {
  wallet: FundingWallet;
  navigateToHostedOnramp: (url: string) => void;
};

export function FundingExperienceForWallet(
  props: FundingExperienceForWalletProps,
) {
  return (
    <FundingExperienceBoundary
      key={fundingBoundary(props.wallet) ?? "signed-out"}
      {...props}
    />
  );
}

function FundingExperienceBoundary({
  wallet,
  navigateToHostedOnramp,
  returnedFromCoinbase = false,
  open = true,
  onClose,
  initialStep,
  onStepChange,
  regionId = "GLOBAL",
}: FundingExperienceForWalletProps) {
  const boundary = fundingBoundary(wallet);
  const session = wallet.status === "verified" ? wallet.session : null;
  const address = session?.smartAccount?.address ?? null;
  const queryOwnerKey = session?.smartAccount ? activityOwnerKey(session) : null;
  const signedOut = !boundary || !session?.smartAccount || !address;
  const startStep: AddMoneyStep =
    initialStep ?? (returnedFromCoinbase && !signedOut ? "receive" : "method");
  const [step, setStep] = useState<AddMoneyStep>(startStep);
  const [openingOnramp, setOpeningOnramp] = useState(false);
  const [onrampError, setOnrampError] = useState<string | null>(null);
  const [selectedBinding, setSelectedBinding] = useState<FundingBinding | null>(null);
  const [initialOrder, setInitialOrder] = useState<FundingOrderSummary | null>(null);
  const stepRef = useRef<AddMoneyStep>(startStep);
  const navigationEpochRef = useRef(0);
  const requestEpochRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);
  const openRef = useRef(open);
  const wasOpenRef = useRef(open);
  const onStepChangeRef = useRef(onStepChange);
  onStepChangeRef.current = onStepChange;

  const fundingQuery = useHomeQuery({
    queryKey: queryOwnerKey
      ? ownerQueryKey(queryOwnerKey, "funding", regionId)
      : ["unauthenticated", "funding-disabled", regionId],
    enabled: Boolean(open && !signedOut && regionId !== "GLOBAL" && queryOwnerKey),
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
    meta: queryOwnerKey ? ownerQueryMeta(queryOwnerKey, "owner") : undefined,
    queryFn: async ({ signal }) => Promise.all([
      wallet.fetchAccountResource(`/api/funding/providers?region=${encodeURIComponent(regionId)}`, { signal }),
      wallet.fetchAccountResource(`/api/funding/orders?region=${encodeURIComponent(regionId)}`, { signal }),
    ]),
  });

  const providerBindings = useMemo(
    () => fundingQuery.data ? readProviderBindings(fundingQuery.data[0]) : [],
    [fundingQuery.data],
  );

  useEffect(() => {
    onStepChangeRef.current?.(step);
  }, [step]);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (open && !wasOpen && stepRef.current !== startStep) {
      queueMicrotask(() => navigateTo(startStep, false));
    }
  }, [open, startStep]);

  useEffect(() => {
    const values = fundingQuery.data;
    if (!values) return;
    const [, orderValue] = values;
    const navigationEpoch = navigationEpochRef.current;
    const resumed = readFundingOrder(orderValue);
    if (!resumed || stepRef.current !== "method") return;
    const binding = providerBindings.find(
      (candidate) => candidate.providerId === readProviderId(orderValue),
    );
    if (!binding) return;
    queueMicrotask(() => {
      if (
        navigationEpochRef.current !== navigationEpoch ||
        stepRef.current !== "method"
      ) return;
      setSelectedBinding(binding);
      setInitialOrder(resumed);
      navigateTo("order", false);
    });
  }, [fundingQuery.data, providerBindings]);

  useEffect(() => {
    openRef.current = open;
    return () => {
      openRef.current = false;
      requestEpochRef.current += 1;
      requestAbortRef.current?.abort();
      requestAbortRef.current = null;
    };
  }, [open]);

  function cancelPendingOnramp() {
    openRef.current = false;
    requestEpochRef.current += 1;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    setOpeningOnramp(false);
  }

  async function openCoinbase() {
    if (!session?.smartAccount || !boundary || openingOnramp || !openRef.current) return;

    requestAbortRef.current?.abort();
    const controller = new AbortController();
    const requestEpoch = requestEpochRef.current + 1;
    requestEpochRef.current = requestEpoch;
    requestAbortRef.current = controller;
    setOpeningOnramp(true);
    setOnrampError(null);

    try {
      const hosted = await requestHostedOnrampSession({
        fetchAccountResource: wallet.fetchAccountResource,
        signal: controller.signal,
      });
      if (
        controller.signal.aborted ||
        requestEpochRef.current !== requestEpoch ||
        !openRef.current
      ) {
        return;
      }
      navigateToHostedOnramp(hosted.url);
    } catch (error) {
      if (
        controller.signal.aborted ||
        requestEpochRef.current !== requestEpoch ||
        !openRef.current
      ) {
        return;
      }
      setOnrampError(messageForOnrampError(error));
      setOpeningOnramp(false);
    } finally {
      if (requestEpochRef.current === requestEpoch) {
        requestAbortRef.current = null;
      }
    }
  }

  function navigateTo(next: AddMoneyStep, explicit = true) {
    if (explicit) navigationEpochRef.current += 1;
    stepRef.current = next;
    setStep(next);
  }

  function close() {
    cancelPendingOnramp();
    navigateTo("method");
    setSelectedBinding(null);
    setInitialOrder(null);
    setOnrampError(null);
    onClose?.();
  }

  function goBack() {
    cancelPendingOnramp();
    openRef.current = true;
    navigateTo("method");
    setSelectedBinding(null);
    setInitialOrder(null);
    setOnrampError(null);
  }

  return (
    <AddMoneyDialog
      open={open}
      step={signedOut ? "method" : step}
      address={address}
      openingOnramp={openingOnramp}
      onrampError={onrampError}
      signedOut={signedOut}
      regionId={regionId}
      onClose={close}
      onBack={goBack}
      onSelectReceive={() => navigateTo("receive")}
      providerBindings={providerBindings}
      selectedBinding={selectedBinding}
      initialOrder={initialOrder}
      fetchAccountResource={wallet.fetchAccountResource}
      queryOwnerKey={queryOwnerKey}
      onSelectBinding={(binding) => {
        setSelectedBinding(binding);
        setInitialOrder(null);
        navigateTo("order");
      }}
      onSelectBuy={() => {
        openRef.current = true;
        setOnrampError(null);
        navigateTo("buy");
      }}
      onSelectAnotherOnramp={() => {
        openRef.current = true;
        setOnrampError(null);
        navigateTo("onramps");
      }}
      onContinueToCoinbase={() => void openCoinbase()}
    />
  );
}

function fundingBoundary(wallet: FundingWallet): string | null {
  const session = wallet.status === "verified" ? wallet.session : null;
  return wallet.ownerKey && session?.smartAccount
    ? `${wallet.ownerKey}\u0000${session.user.subject}\u0000${session.smartAccount.address}\u0000${session.accountProvider}`
    : null;
}

function readProviderBindings(value: unknown): ReadonlyArray<FundingBinding> {
  if (!isRecord(value) || !Array.isArray(value.providers)) return [];
  return value.providers.filter((item): item is FundingBinding => isRecord(item) && typeof item.providerId === "string" && typeof item.displayName === "string" && typeof item.region === "string" && typeof item.assetId === "string" && typeof item.assetSymbol === "string" && Number.isSafeInteger(item.assetDecimals) && typeof item.currency === "string" && Array.isArray(item.paymentMethods));
}
function readProviderId(value: unknown): string | null { return isRecord(value) && isRecord(value.order) && typeof value.order.providerId === "string" ? value.order.providerId : null; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

function messageForOnrampError(error: unknown): string {
  if (error instanceof FundingRequestError && error.code === "unauthenticated") {
    return "Your session changed. Sign in again to continue.";
  }
  return "Coinbase funding is unavailable. Try again later or choose another deposit method.";
}
