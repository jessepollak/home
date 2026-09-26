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
import { shouldPollFundingOrder } from "./order-polling";
import { readFundingOrder, type FundingOrderSummary } from "@/shared/funding/contracts/order";
import { readProviderBindings, type FundingBinding } from "@/shared/funding/contracts/providers";
import { readFundingProviderCustomers, type FundingProviderCustomerSummary } from "@/shared/funding/contracts/provider-customers";
import { ownerQueryKey, ownerQueryMeta, useHomeQuery } from "@/client/query/query-client";

const AddMoneySheet = deferSheet(() => import("./add-money-dialog").then((module) => module.AddMoneyDialog));

export const preloadAddMoneySheet = AddMoneySheet.preload;

export type FundingExperienceProps = {
  returnedFromProvider?: boolean;
  returnedFromVerification?: boolean;
  open?: boolean;
  onClose?: () => void;
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
  const [initialCustomer, setInitialCustomer] = useState<FundingProviderCustomerSummary | null>(null);
  const stepRef = useRef<AddMoneyStep>(startStep);
  const navigationEpochRef = useRef(0);
  const returnResumeRef = useRef(returnResumeEligible);
  const wasOpenRef = useRef(open);
  const onStepChangeRef = useRef(onStepChange);

  useEffect(() => {
    onStepChangeRef.current = onStepChange;
  }, [onStepChange]);

  useEffect(() => {
    returnResumeRef.current = returnResumeEligible;
  }, [returnResumeEligible]);

  const spendReturnResume = useCallback(() => {
    if (!returnResumeRef.current) return;
    returnResumeRef.current = false;
    onReturnResumeSpent();
  }, [onReturnResumeSpent]);

  const navigateTo = useCallback((next: AddMoneyStep, explicit = true) => {
    if (explicit) {
      navigationEpochRef.current += 1;
      spendReturnResume();
    }
    stepRef.current = next;
    setStep(next);
  }, [spendReturnResume]);

  const queryEnabled = Boolean(
    open && regionReady && !signedOut && regionId !== "GLOBAL" && queryOwnerKey,
  );
  const providerQuery = useHomeQuery({
    queryKey: queryOwnerKey
      ? ownerQueryKey(queryOwnerKey, "funding-providers", regionId)
      : ["unauthenticated", "funding-providers-disabled", regionId],
    enabled: queryEnabled,
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
    meta: queryOwnerKey ? ownerQueryMeta(queryOwnerKey, "owner") : undefined,
    queryFn: ({ signal }) =>
      wallet.fetchAccountResource(
        `/api/funding/providers?region=${encodeURIComponent(regionId)}&direction=onramp`,
        { signal },
      ),
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
    queryKey: queryOwnerKey
      ? ownerQueryKey(queryOwnerKey, "funding-open-order", regionId)
      : ["unauthenticated", "funding-open-order-disabled", regionId],
    enabled: queryEnabled,
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
    meta: queryOwnerKey ? ownerQueryMeta(queryOwnerKey, "owner") : undefined,
    queryFn: ({ signal }) =>
      wallet.fetchAccountResource(
        `/api/funding/orders?region=${encodeURIComponent(regionId)}`,
        { signal },
      ),
  });

  useEffect(() => {
    onStepChangeRef.current?.(step);
  }, [step]);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (!open) spendReturnResume();
    if (open && !wasOpen && stepRef.current !== startStep) {
      queueMicrotask(() => navigateTo(startStep, false));
    }
  }, [open, startStep, navigateTo, spendReturnResume]);

  useEffect(() => {
    const orderValue = ordersQuery.data;
    if (!open || !regionReady || !returnResumeRef.current || !orderValue) return;
    const navigationEpoch = navigationEpochRef.current;
    const resumed = readFundingOrder(orderValue);
    if (!resumed || stepRef.current !== "method") return;
    const binding = providerBindings.find(
      (candidate) => orderMatchesBinding(resumed, candidate),
    );
    if (!binding) return;
    queueMicrotask(() => {
      if (
        navigationEpochRef.current !== navigationEpoch ||
        !returnResumeRef.current ||
        stepRef.current !== "method"
      ) return;
      spendReturnResume();
      setSelectedBinding(binding);
      setInitialOrder(resumed);
      navigateTo("order", false);
    });
  }, [open, ordersQuery.data, providerBindings, regionReady, returnResumeEligible, navigateTo, spendReturnResume]);

  useEffect(() => {
    if (!open || !regionReady || !returnResumeRef.current || !returnedFromVerification || !ordersQuery.isSuccess || readFundingOrder(ordersQuery.data) || stepRef.current !== "method") return;
    const customers = readFundingProviderCustomers(customersQuery.data);
    const customer = customers.find((candidate) => candidate.state !== "verified") ?? customers[0];
    if (!customer) return;
    const binding = providerBindings.find((candidate) => candidate.providerId === customer.providerId && candidate.customerSetup);
    if (!binding) return;
    const navigationEpoch = navigationEpochRef.current;
    queueMicrotask(() => {
      if (navigationEpochRef.current !== navigationEpoch || !returnResumeRef.current || stepRef.current !== "method") return;
      spendReturnResume();
      setSelectedBinding(binding); setInitialCustomer(customer); navigateTo("order", false);
    });
  }, [customersQuery.data, open, ordersQuery.data, ordersQuery.isSuccess, providerBindings, regionReady, returnedFromVerification, returnResumeEligible, navigateTo, spendReturnResume]);

  const customerSetupReady = customersQuery.isSuccess || !customerSetupRequired;
  const openOrder = readFundingOrder(ordersQuery.data);
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

  function close() {
    navigateTo("method");
    setSelectedBinding(null);
    setInitialOrder(null);
    setInitialCustomer(null);
    onClose?.();
  }

  function goBack() {
    navigateTo("method");
    setSelectedBinding(null);
    setInitialOrder(null);
    setInitialCustomer(null);
  }

  return (
    <AddMoneySheet
      open={open}
      step={signedOut ? "method" : step}
      address={address}
      signedOut={signedOut}
      regionId={regionId}
      onClose={close}
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
      initialCustomer={initialCustomer}
      fetchAccountResource={wallet.fetchAccountResource}
      queryOwnerKey={queryOwnerKey}
      onSelectBinding={(binding) => {
        if (!regionReady) return;
        setSelectedBinding(binding);
        setInitialOrder(isResumableBinding(openOrder, binding) ? openOrder : null);
        setInitialCustomer(readFundingProviderCustomers(customersQuery.data).find((customer) => customer.providerId === binding.providerId) ?? null);
        navigateTo("order");
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
