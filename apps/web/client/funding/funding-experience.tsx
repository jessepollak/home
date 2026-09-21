"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RegionId } from "@/config/regions";
import { useAccountWallet, type AccountWalletClient } from "@/client/account/cdp-client";
import { dataOwnerKey, uiBoundary } from "@/client/account/owner-keys";
import {
  AddMoneyDialog,
  type AddMoneyStep,
} from "./add-money-dialog";
import { readFundingOrder, readProviderId, type FundingOrderSummary } from "@/shared/funding/contracts/order";
import { readProviderBindings, type FundingBinding } from "@/shared/funding/contracts/providers";
import { readFundingProviderCustomers, type FundingProviderCustomerSummary } from "@/shared/funding/contracts/provider-customers";
import { ownerQueryKey, ownerQueryMeta, useHomeQuery } from "@/client/query/query-client";

export type FundingExperienceProps = {
  returnedFromProvider?: boolean;
  returnedFromVerification?: boolean;
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
  return (
    <FundingExperienceBoundary
      key={uiBoundary(props.wallet) ?? "signed-out"}
      {...props}
    />
  );
}

function FundingExperienceBoundary({
  wallet,
  navigateToRedirect,
  returnedFromProvider = false,
  returnedFromVerification = false,
  open = true,
  onClose,
  initialStep,
  onStepChange,
  regionId = "GLOBAL",
}: FundingExperienceForWalletProps) {
  const boundary = uiBoundary(wallet);
  const session = wallet.status === "verified" ? wallet.session : null;
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
  const wasOpenRef = useRef(open);
  const onStepChangeRef = useRef(onStepChange);
  onStepChangeRef.current = onStepChange;

  const queryEnabled = Boolean(
    open && !signedOut && regionId !== "GLOBAL" && queryOwnerKey,
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
  const providerBindings = useMemo(
    () => providerQuery.data ? readProviderBindings(providerQuery.data) : [],
    [providerQuery.data],
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
    if (open && !wasOpen && stepRef.current !== startStep) {
      queueMicrotask(() => navigateTo(startStep, false));
    }
  }, [open, startStep]);

  useEffect(() => {
    const orderValue = ordersQuery.data;
    if (!orderValue) return;
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
  }, [ordersQuery.data, providerBindings]);

  useEffect(() => {
    if (!returnedFromVerification || !ordersQuery.isSuccess || readFundingOrder(ordersQuery.data) || stepRef.current !== "method") return;
    const customers = readFundingProviderCustomers(customersQuery.data);
    const customer = customers.find((candidate) => candidate.state !== "verified") ?? customers[0];
    if (!customer) return;
    const binding = providerBindings.find((candidate) => candidate.providerId === customer.providerId && candidate.customerSetup);
    if (!binding) return;
    const navigationEpoch = navigationEpochRef.current;
    queueMicrotask(() => {
      if (navigationEpochRef.current !== navigationEpoch || stepRef.current !== "method") return;
      setSelectedBinding(binding); setInitialCustomer(customer); navigateTo("order", false);
    });
  }, [customersQuery.data, ordersQuery.data, ordersQuery.isSuccess, providerBindings, returnedFromVerification]);

  const customerSetupReady = customersQuery.isSuccess || !customerSetupRequired;
  const fundingReadError = providerQuery.isError
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

  function navigateTo(next: AddMoneyStep, explicit = true) {
    if (explicit) navigationEpochRef.current += 1;
    stepRef.current = next;
    setStep(next);
  }

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
    <AddMoneyDialog
      open={open}
      step={signedOut ? "method" : step}
      address={address}
      signedOut={signedOut}
      regionId={regionId}
      onClose={close}
      onBack={goBack}
      onSelectReceive={() => navigateTo("receive")}
      providerBindings={providerBindings}
      providerBindingsDisabled={!ordersQuery.isSuccess}
      customerSetupReady={customerSetupReady}
      fundingReadError={fundingReadError}
      selectedBinding={selectedBinding}
      initialOrder={initialOrder}
      initialCustomer={initialCustomer}
      fetchAccountResource={wallet.fetchAccountResource}
      queryOwnerKey={queryOwnerKey}
      onSelectBinding={(binding) => {
        setSelectedBinding(binding);
        setInitialOrder(null);
        setInitialCustomer(readFundingProviderCustomers(customersQuery.data).find((customer) => customer.providerId === binding.providerId) ?? null);
        navigateTo("order");
      }}
      onOpenRedirect={navigateToRedirect}
    />
  );
}
