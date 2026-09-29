"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RegionId } from "@/config/regions";
import {
  isServerVerified,
  useAccountWallet,
  type AccountWalletClient,
} from "@/client/account/cdp-client";
import { dataOwnerKey, uiBoundary } from "@/client/account/owner-keys";
import { deferSheet } from "@/client/money-modal/deferred-sheet";
import type { AddMoneyStep, ProvidersStatus } from "./add-money-dialog";
import { addMoneySheetLoading } from "./method-skeleton";
import { shouldPollFundingOrder } from "./order-polling";
import { readFundingOrder, type FundingOrderSummary } from "@/shared/funding/contracts/order";
import { readProviderBindings, type FundingBinding } from "@/shared/funding/contracts/providers";
import { readFundingProviderCustomers, type FundingProviderCustomerSummary } from "@/shared/funding/contracts/provider-customers";
import { ownerQueryKey, ownerQueryMeta, useHomeQuery } from "@/client/query/query-client";
import { fundingProvidersOptions, fundingOpenOrderOptions } from "./funding-prefetch";

const AddMoneySheet = deferSheet(() => import("./add-money-dialog").then((module) => module.AddMoneyDialog),
  addMoneySheetLoading);

export const preloadAddMoneySheet = AddMoneySheet.preload;

export type FundingExperienceProps = {
  returnedFromProvider?: boolean;
  returnedFromVerification?: boolean;
  open?: boolean;
  onClose?: () => void;
  onClosed?: () => void;
  initialStep?: AddMoneyStep;
  onStepChange?: (step: AddMoneyStep) => void;
  regionId?: RegionId;
  regionReady?: boolean;
};

type FundingWallet = Pick<
  AccountWalletClient,
  "ownerKey" | "status" | "verification" | "session" | "fetchAccountResource"
>;

export function FundingExperience(props: FundingExperienceProps) {
  const wallet = useAccountWallet();
  return (
    <FundingExperienceForWallet
      {...props}
      wallet={wallet}
      navigateToRedirect={(url) => window.location.assign(url)}
    />
  );
}

type FundingExperienceForWalletProps = FundingExperienceProps & {
  wallet: FundingWallet;
  navigateToRedirect: (url: string) => void;
};

export function FundingExperienceForWallet(
  props: FundingExperienceForWalletProps,
) {
  const boundary = uiBoundary(props.wallet);
  const regionId = props.regionId ?? "GLOBAL";
  const regionReady = props.regionReady ?? true;
  const requested = Boolean(props.returnedFromProvider || props.returnedFromVerification);
  const [returnEntry, setReturnEntry] = useState<{ boundary: string | null; regionId: RegionId; ready: boolean; eligible: boolean; requested: boolean }>(() => ({
    boundary,
    regionId,
    ready: regionReady,
    eligible: requested,
    requested,
  }));
  const spendReturnEntry = useCallback(
    () => setReturnEntry((entry) => entry.eligible ? { ...entry, eligible: false } : entry),
    [],
  );
  const boundaryChanged = boundary !== null && returnEntry.boundary !== null && returnEntry.boundary !== boundary;
  const regionChanged = returnEntry.regionId !== regionId;
  const regionChangedAfterReady = returnEntry.ready && regionChanged;
  if (requested !== returnEntry.requested) {
    setReturnEntry(requested
      ? { boundary, regionId, ready: regionReady, eligible: true, requested: true }
      : { ...returnEntry, eligible: false, requested: false });
  } else if ((returnEntry.boundary === null && boundary !== null) || (!returnEntry.ready && regionReady) || (boundaryChanged && returnEntry.eligible) || (regionChanged && (!returnEntry.ready || returnEntry.eligible))) {
    setReturnEntry({
      ...returnEntry,
      boundary: returnEntry.boundary ?? boundary,
      regionId: returnEntry.ready ? returnEntry.regionId : regionId,
      ready: returnEntry.ready || regionReady,
      eligible: returnEntry.eligible && !boundaryChanged && !regionChangedAfterReady,
    });
  }
  return (
    <FundingExperienceBoundary
      key={`${boundary ?? "signed-out"}:${regionId}`}
      {...props}
      returnResumeEligible={returnEntry.eligible && regionReady && !boundaryChanged && !(regionReady && regionChanged)}
      onReturnResumeSpent={spendReturnEntry}
    />
  );
}

function FundingExperienceBoundary({
  wallet,
  navigateToRedirect,
  returnResumeEligible,
  onReturnResumeSpent,
  returnedFromProvider = false,
  returnedFromVerification = false,
  open = true,
  onClose,
  onClosed,
  initialStep,
  onStepChange,
  regionId = "GLOBAL",
  regionReady = true,
}: FundingExperienceForWalletProps & { returnResumeEligible: boolean; onReturnResumeSpent: () => void }) {
  const boundary = uiBoundary(wallet);
  const session = isServerVerified(wallet) ? wallet.session : null;
  const address = session?.smartAccount?.address ?? null;
  const queryOwnerKey = session?.smartAccount ? dataOwnerKey(session) : null;
  const signedOut = !boundary || !session?.smartAccount || !address;
  const startStep: AddMoneyStep =
    initialStep ?? (returnedFromProvider && !signedOut ? "receive" : "method");
  const [step, setStep] = useState<AddMoneyStep>(startStep);
  const [selectedBinding, setSelectedBinding] = useState<FundingBinding | null>(null);
  const [initialOrder, setInitialOrder] = useState<FundingOrderSummary | null>(null);
  const [promptOrder, setPromptOrder] = useState<FundingOrderSummary | null>(null);
  const [initialCustomer, setInitialCustomer] = useState<FundingProviderCustomerSummary | null>(null);
  const [previousOpen, setPreviousOpen] = useState(open);
  const [previousResumeEligible, setPreviousResumeEligible] = useState(returnResumeEligible);
  const [resumeConsumed, setResumeConsumed] = useState(!open);
  const onStepChangeRef = useRef(onStepChange);

  useEffect(() => {
    onStepChangeRef.current = onStepChange;
  }, [onStepChange]);

  function spendReturnResume() {
    if (!returnResumeEligible || resumeConsumed) return;
    setResumeConsumed(true);
    onReturnResumeSpent();
  }

  function navigateTo(next: AddMoneyStep) {
    spendReturnResume();
    setStep(next);
  }

  const queryEnabled = Boolean(
    open && regionReady && !signedOut && regionId !== "GLOBAL" && queryOwnerKey,
  );
  const providerQuery = useHomeQuery({
    ...fundingProvidersOptions(queryOwnerKey, regionId, wallet.fetchAccountResource),
    enabled: queryEnabled,
  });
  const providersFailed = queryEnabled && providerQuery.isError;
  const providersStatus: ProvidersStatus = !regionReady
    ? open ? "loading" : "unavailable"
    : providersFailed
      ? providerQuery.isFetching ? "loading" : "failed"
      : providerQuery.data !== undefined
        ? "loaded"
        : queryEnabled ? "loading" : "unavailable";
  const providerBindings = useMemo(
    () => regionReady && providerQuery.data && !providersFailed ? readProviderBindings(providerQuery.data) : [],
    [providerQuery.data, providersFailed, regionReady],
  );
  const customerSetupRequired = providerBindings.some(
    (binding) => binding.customerSetup !== null,
  );
  const customersQuery = useHomeQuery({
    queryKey: queryOwnerKey
      ? ownerQueryKey(queryOwnerKey, "funding-provider-customers", regionId)
      : ["unauthenticated", "funding-provider-customers-disabled", regionId],
    enabled: queryEnabled && customerSetupRequired,
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
    meta: queryOwnerKey ? ownerQueryMeta(queryOwnerKey, "owner") : undefined,
    queryFn: ({ signal }) => wallet.fetchAccountResource(`/api/funding/provider-customers?region=${encodeURIComponent(regionId)}`, { signal }),
  });
  const ordersQuery = useHomeQuery({
    ...fundingOpenOrderOptions(queryOwnerKey, regionId, wallet.fetchAccountResource),
    enabled: queryEnabled,
  });

  useEffect(() => {
    onStepChangeRef.current?.(step);
  }, [step]);

  if (previousResumeEligible !== returnResumeEligible) {
    setPreviousResumeEligible(returnResumeEligible);
    setResumeConsumed(false);
  }
  if (previousOpen !== open) {
    setPreviousOpen(open);
    if (open && step !== startStep) setStep(startStep);
    if (!open) {
      setPromptOrder(null);
      setResumeConsumed(true);
    }
  }

  const eligibleToResume = open && regionReady && returnResumeEligible &&
    !resumeConsumed && previousResumeEligible === returnResumeEligible && step === "method";
  const openOrder = readFundingOrder(ordersQuery.data);
  const resumedBinding = eligibleToResume && openOrder
    ? providerBindings.find((candidate) => orderMatchesBinding(openOrder, candidate))
    : null;
  const customers = eligibleToResume && returnedFromVerification && ordersQuery.isSuccess && !openOrder
    ? readFundingProviderCustomers(customersQuery.data)
    : [];
  const customer = customers.find((candidate) => candidate.state !== "verified") ?? customers[0];
  const customerBinding = customer
    ? providerBindings.find((candidate) => candidate.providerId === customer.providerId && candidate.customerSetup)
    : null;
  if (resumedBinding && openOrder) {
    setResumeConsumed(true);
    setSelectedBinding(resumedBinding);
    setInitialOrder(openOrder);
    setStep("order");
  } else if (customerBinding && customer) {
    setResumeConsumed(true);
    setSelectedBinding(customerBinding);
    setInitialCustomer(customer);
    setStep("order");
  }

  useEffect(() => {
    if ((!open || resumeConsumed) && returnResumeEligible) onReturnResumeSpent();
  }, [open, resumeConsumed, returnResumeEligible, onReturnResumeSpent]);

  const customerSetupReady = customersQuery.isSuccess || !customerSetupRequired;
  const fundingReadError = providersStatus === "failed"
    ? {
        message: "Funding methods are unavailable. Try again.",
        retry: () => void providerQuery.refetch(),
      }
    : ordersQuery.isError && providerBindings.length > 0
      ? {
          message: "Home couldn't check for an open deposit. Retry.",
          retry: () => void ordersQuery.refetch(),
        }
      : customersQuery.isError && customerSetupRequired
        ? {
            message: "Home couldn't check your provider setup. Retry.",
            retry: () => void customersQuery.refetch(),
          }
        : null;

  function resetJourney() {
    navigateTo("method");
    setSelectedBinding(null);
    setInitialOrder(null);
    setPromptOrder(null);
    setInitialCustomer(null);
  }

  function goBack() {
    navigateTo("method");
    setSelectedBinding(null);
    setInitialOrder(null);
    setPromptOrder(null);
    setInitialCustomer(null);
  }

  return (
    <AddMoneySheet
      open={open}
      step={signedOut ? "method" : step}
      address={address}
      signedOut={signedOut}
      regionId={regionId}
      onClose={() => onClose?.()}
      onClosed={() => { resetJourney(); onClosed?.(); }}
      onBack={goBack}
      onSelectReceive={() => navigateTo("receive")}
      providerBindings={providerBindings}
      providersStatus={providersStatus}
      providerBindingsDisabled={!regionReady || !ordersQuery.isSuccess}
      customerSetupReady={customerSetupReady}
      resumableBinding={(binding) => isResumableBinding(openOrder, binding)}
      fundingReadError={fundingReadError}
      selectedBinding={selectedBinding}
      initialOrder={initialOrder}
      promptOrder={promptOrder}
      onContinueOrder={() => {
        setInitialOrder(promptOrder);
        setPromptOrder(null);
        navigateTo("order");
      }}
      onStartNewOrder={() => {
        setInitialOrder(null);
        setPromptOrder(null);
        navigateTo("order");
      }}
      startNewAllowed={promptOrder?.state !== "dispatch-ambiguous" && (!selectedBinding?.customerSetup || customerSetupReady)}
      initialCustomer={initialCustomer}
      fetchAccountResource={wallet.fetchAccountResource}
      queryOwnerKey={queryOwnerKey}
      onSelectBinding={(binding) => {
        if (!regionReady) return;
        setSelectedBinding(binding);
        const resumable = isResumableBinding(openOrder, binding) ? openOrder : null;
        setPromptOrder(resumable);
        setInitialOrder(null);
        setInitialCustomer(readFundingProviderCustomers(customersQuery.data).find((customer) => customer.providerId === binding.providerId) ?? null);
        navigateTo(resumable ? "open-order" : "order");
      }}
      onOpenRedirect={navigateToRedirect}
    />
  );
}

function isResumableBinding(order: FundingOrderSummary | null, binding: FundingBinding): boolean {
  return Boolean(order && orderMatchesBinding(order, binding) &&
    (order.state === "dispatch-ambiguous" || shouldPollFundingOrder(order)));
}

function orderMatchesBinding(order: FundingOrderSummary, binding: FundingBinding): boolean {
  return order.providerId === binding.providerId &&
    (order.region === undefined || order.region === binding.region) &&
    (order.assetId === undefined || order.assetId === binding.assetId) &&
    (order.paymentMethod === undefined || binding.paymentMethods.some((method) => method.id === order.paymentMethod));
}
