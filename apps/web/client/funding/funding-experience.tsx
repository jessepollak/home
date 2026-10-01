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
import { assertFundingOpenOrderResponse, fundingOpenOrderPath, fundingOrderMatchesQuery, readFundingOpenOrderResponse } from "@/shared/funding/contracts/open-order";
import { readFundingOrder, type FundingOrderSummary } from "@/shared/funding/contracts/order";
import { assertFundingProvidersResponse, readProviderBindings, type FundingBinding } from "@/shared/funding/contracts/providers";
import { assertFundingProviderCustomersResponse, readFundingProviderCustomers, type FundingProviderCustomerSummary } from "@/shared/funding/contracts/provider-customers";
import { browserHomeQueryClient, disabledQueryKey, ownerQueryKey, ownerQueryMeta, useHomeQuery, useHomeQueryClient } from "@/client/query/query-client";
import { queryViewState } from "@/client/query/query-view-state";
import { fundingProvidersOptions, fundingOpenOrderOptions, fundingProviderCustomersOptions } from "./funding-prefetch";

const AddMoneySheet = deferSheet(() => import("./add-money-dialog").then((module) => module.AddMoneyDialog),
  addMoneySheetLoading);

export const preloadAddMoneySheet = AddMoneySheet.preload;

export type FundingExperienceProps = {
  opener?: HTMLElement | null;
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
  opener = null,
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
  const [pausedSelectionAttempt, setPausedSelectionAttempt] = useState<number | null>(null);
  const [initialOrder, setInitialOrder] = useState<FundingOrderSummary | null>(null);
  const [promptOrder, setPromptOrder] = useState<FundingOrderSummary | null>(null);
  const [initialCustomer, setInitialCustomer] = useState<FundingProviderCustomerSummary | null>(null);
  const [previousOpen, setPreviousOpen] = useState(open);
  const [previousResumeEligible, setPreviousResumeEligible] = useState(returnResumeEligible);
  const [resumeConsumed, setResumeConsumed] = useState(!open);
  const [missedPausedLookup, setMissedPausedLookup] = useState<number | null>(null);
  const pausedSelectionCountRef = useRef(0);
  const queryClient = useHomeQueryClient(browserHomeQueryClient());
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

  function clearSelection() {
    setSelectedBinding(null);
    setPausedSelectionAttempt(null);
    setInitialOrder(null);
    setPromptOrder(null);
    setInitialCustomer(null);
  }

  const queryEnabled = Boolean(
    open && regionReady && !signedOut && regionId !== "GLOBAL" && queryOwnerKey,
  );
  const providerQuery = useHomeQuery({
    ...fundingProvidersOptions(queryOwnerKey, regionId, wallet.fetchAccountResource),
    enabled: queryEnabled,
  });
  const providersValid = providerQuery.data !== undefined && validFundingEnvelope(providerQuery.data, (value) => assertFundingProvidersResponse(value, "onramp", regionId));
  const providersView = queryViewState(providerQuery, { hasCachedData: providerQuery.data !== undefined, degraded: providerQuery.data !== undefined && !providersValid });
  const providersFailed = queryEnabled && (providersView === "failed" || providersView === "failed-with-data");
  const providersStatus: ProvidersStatus = !regionReady
    ? open ? "loading" : "unavailable"
    : providersValid
      ? "loaded"
      : providersFailed
        ? providerQuery.isFetching ? "loading" : "failed"
        : queryEnabled ? "loading" : "unavailable";
  const providerBindings = useMemo(
    () => regionReady && providersValid ? readProviderBindings(providerQuery.data) : [],
    [providerQuery.data, providersValid, regionReady],
  );
  const customerSetupRequired = providerBindings.some(
    (binding) => binding.customerSetup !== null,
  );
  const customersQuery = useHomeQuery({
    ...fundingProviderCustomersOptions(queryOwnerKey, regionId, wallet.fetchAccountResource),
    enabled: queryEnabled && customerSetupRequired,
  });
  const ordersQuery = useHomeQuery({
    ...fundingOpenOrderOptions(queryOwnerKey, regionId, wallet.fetchAccountResource),
    enabled: queryEnabled,
  });
  const resumeProviderId = selectedBinding?.direction === "onramp" && selectedBinding.resumeOnly === true
    ? selectedBinding.providerId : null;
  const pausedOrderQuery = useHomeQuery({
    queryKey: queryOwnerKey
      ? ownerQueryKey(queryOwnerKey, "funding-open-order-by-provider", regionId, resumeProviderId,
        selectedBinding?.paymentMethods.map((method) => method.id).join(","), pausedSelectionAttempt)
      : disabledQueryKey("funding-open-order-by-provider", regionId),
    enabled: queryEnabled && resumeProviderId !== null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    meta: queryOwnerKey ? ownerQueryMeta(queryOwnerKey, "owner") : undefined,
    queryFn: async ({ signal }) => {
      if (!selectedBinding || !resumeProviderId) throw new Error("No provider selected.");
      const methods = selectedBinding.paymentMethods;
      const results = await Promise.allSettled(methods.map((method) =>
        wallet.fetchAccountResource(fundingOpenOrderPath({ region: regionId, providerId: resumeProviderId, paymentMethod: method.id, assetId: selectedBinding.assetId }), { signal })));
      const candidates: FundingOrderSummary[] = [];
      let unreadable = false;
      methods.forEach((method, index) => {
        const result = results[index];
        if (!result || result.status !== "fulfilled") {
          unreadable = true;
          return;
        }
        const response = readFundingOpenOrderResponse(result.value);
        const order = response?.order ?? null;
        if (!response) {
          unreadable = true;
          return;
        }
        if (!order) return;
        if (typeof order.assetId !== "string" ||
          !fundingOrderMatchesQuery(order, { region: regionId, providerId: resumeProviderId, paymentMethod: method.id, assetId: selectedBinding.assetId })) {
          unreadable = true;
          return;
        }
        if (isResumableBinding(order, selectedBinding)) candidates.push(order);
      });
      const order = candidates.sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""))[0];
      if (!order && unreadable) throw new Error("The open deposit could not be checked.");
      return { order: order ?? null };
    },
  });

  const pausedLookupSettled = open && selectedBinding !== null && resumeProviderId !== null &&
    pausedSelectionAttempt !== null && step === "method" &&
    pausedOrderQuery.isSuccess && pausedOrderQuery.isFetchedAfterMount && !pausedOrderQuery.isFetching;
  const pausedOrder = pausedLookupSettled ? readFundingOrder(pausedOrderQuery.data) : null;

  useEffect(() => {
    if (missedPausedLookup === null || !queryOwnerKey) return;
    void queryClient.invalidateQueries({ queryKey: ownerQueryKey(queryOwnerKey, "funding-providers", regionId) });
  }, [missedPausedLookup, queryClient, queryOwnerKey, regionId]);

  const ordersValid = ordersQuery.data !== undefined && validFundingEnvelope(ordersQuery.data, (value) => assertFundingOpenOrderResponse(value, regionId));
  const customersValid = customersQuery.data !== undefined && validFundingEnvelope(customersQuery.data, (value) => assertFundingProviderCustomersResponse(value, regionId));
  const ordersData = ordersValid ? ordersQuery.data : undefined;
  const customersData = customersValid ? customersQuery.data : undefined;

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
      clearSelection();
      setResumeConsumed(true);
    }
  }

  const eligibleToResume = open && regionReady && returnResumeEligible &&
    !resumeConsumed && previousResumeEligible === returnResumeEligible && step === "method";
  const openOrder = readFundingOrder(ordersData);
  const resumedBinding = eligibleToResume && openOrder
    ? providerBindings.find((candidate) => orderMatchesBinding(openOrder, candidate))
    : null;
  const customers = eligibleToResume && returnedFromVerification && ordersQuery.isSuccess &&
    ordersData !== undefined && customersData !== undefined && !openOrder
    ? readFundingProviderCustomers(customersData)
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
  } else if (pausedOrder && selectedBinding && isResumableBinding(pausedOrder, selectedBinding)) {
    setPromptOrder(pausedOrder);
    if (returnResumeEligible) setResumeConsumed(true);
    setStep("open-order");
  } else if (pausedLookupSettled && pausedOrder === null && pausedSelectionAttempt !== null) {
    setMissedPausedLookup(pausedSelectionAttempt);
    clearSelection();
  }

  useEffect(() => {
    if ((!open || resumeConsumed) && returnResumeEligible) onReturnResumeSpent();
  }, [open, resumeConsumed, returnResumeEligible, onReturnResumeSpent]);

  const customerSetupReady = (customersQuery.isSuccess && customersValid && !customersQuery.isFetching) || !customerSetupRequired;
  const ordersView = queryViewState(ordersQuery, { hasCachedData: ordersQuery.data !== undefined, isEmpty: ordersValid && ordersQuery.data?.order === null, degraded: ordersQuery.data !== undefined && !ordersValid });
  const customersView = queryViewState(customersQuery, { hasCachedData: customersQuery.data !== undefined, isEmpty: customersValid && customersQuery.data?.customers.length === 0, degraded: customersQuery.data !== undefined && !customersValid });
  const providersReadFailed = providersFailed && !providerQuery.isFetching;
  const ordersReadFailed = (ordersView === "failed" || ordersView === "failed-with-data") && providerBindings.length > 0;
  const customersReadFailed = (customersView === "failed" || customersView === "failed-with-data") && customerSetupRequired;
  const fundingReadError = !providersValid && providersReadFailed
    ? {
        message: "Funding methods are unavailable. Try again.",
        retry: () => void providerQuery.refetch(),
      }
    : pausedOrderQuery.isError && resumeProviderId
      ? {
          message: "Home couldn't check your open deposit. Retry.",
          retry: () => void pausedOrderQuery.refetch(),
        }
      : ordersReadFailed
        ? {
            message: "Home couldn't check for an open deposit. Retry.",
            retry: () => void ordersQuery.refetch(),
          }
        : customersReadFailed
          ? {
              message: "Home couldn't check your provider setup. Retry.",
              retry: () => void customersQuery.refetch(),
            }
          : providersReadFailed
            ? {
                message: "Couldn't refresh funding methods. Try again.",
                retry: () => void providerQuery.refetch(),
              }
            : null;

  function resetJourney() {
    navigateTo("method");
    clearSelection();
  }

  function goBack() {
    navigateTo("method");
    clearSelection();
  }

  return (
    <AddMoneySheet
      open={open}
      opener={opener}
      step={signedOut ? "method" : step}
      address={address}
      signedOut={signedOut}
      regionId={regionId}
      onClose={() => { clearSelection(); onClose?.(); }}
      onClosed={() => { resetJourney(); onClosed?.(); }}
      onBack={goBack}
      onSelectReceive={() => navigateTo("receive")}
      providerBindings={providerBindings}
      providersStatus={providersStatus}
      providerBindingsDisabled={!regionReady || !ordersQuery.isSuccess || !ordersValid || ordersQuery.isFetching}
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
      startNewAllowed={!(selectedBinding?.direction === "onramp" && selectedBinding.resumeOnly === true) && promptOrder?.state !== "dispatch-ambiguous" && (!selectedBinding?.customerSetup || customerSetupReady)}
      initialCustomer={initialCustomer}
      fetchAccountResource={wallet.fetchAccountResource}
      queryOwnerKey={queryOwnerKey}
      onSelectBinding={(binding) => {
        if (!regionReady) return;
        const paused = binding.direction === "onramp" && binding.resumeOnly === true;
        const selectionAttempt = paused ? ++pausedSelectionCountRef.current : null;
        setSelectedBinding(binding);
        setPausedSelectionAttempt(selectionAttempt);
        if (paused) {
          setPromptOrder(null);
          setInitialOrder(null);
          setInitialCustomer(readFundingProviderCustomers(customersData).find((customer) => customer.providerId === binding.providerId) ?? null);
          return;
        }
        const resumable = isResumableBinding(openOrder, binding) ? openOrder : null;
        setPromptOrder(resumable);
        setInitialOrder(null);
        setInitialCustomer(readFundingProviderCustomers(customersData).find((customer) => customer.providerId === binding.providerId) ?? null);
        navigateTo(resumable ? "open-order" : "order");
      }}
      onOpenRedirect={navigateToRedirect}
    />
  );
}

function validFundingEnvelope(value: unknown, assertResponse: (value: unknown) => void): boolean {
  try {
    assertResponse(value);
    return true;
  } catch {
    return false;
  }
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
