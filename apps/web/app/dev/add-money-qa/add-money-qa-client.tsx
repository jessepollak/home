"use client";

import { useRef } from "react";
import { useSearchParams } from "next/navigation";
import { HomeExperience } from "@/app/home-experience";
import {
  AccountWalletClientProvider,
  createBlockedAccountWalletClient,
  type AccountWalletClient,
} from "@/features/account/cdp-client";
import { BASE_CHAIN_ID } from "@/features/account/session-types";
import {
  AddMoneyDialog,
  type AddMoneyStep,
  type OnrampPaymentSummary,
  type PostCheckoutPayment,
} from "@/features/funding/add-money-dialog";

const ADDRESS = "0x22111d000000000000000000000000000077daa9" as const;
const PAYMENT: OnrampPaymentSummary = {
  paymentAmount: "42.5",
  paymentMethod: "google-pay",
};
const POST_CHECKOUT_PAYMENT: PostCheckoutPayment = {
  ...PAYMENT,
  receiptUrl: "/dev/add-money-qa/frame",
};

const qaClient: AccountWalletClient = {
  ...createBlockedAccountWalletClient("unconfigured"),
  projectConfigured: true,
  signInAvailability: "ready",
  isSignedIn: true,
  ownerKey: "add-money-qa-owner",
  status: "verified",
  session: {
    user: { subject: "add-money-qa-subject" },
    smartAccount: { address: ADDRESS, chainId: BASE_CHAIN_ID },
    accountProvider: "base-account",
  },
  fetchOperations: async () => ({ operations: [] }),
};

export function AddMoneyQaClient() {
  const searchParams = useSearchParams();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const state = searchParams.get("state");

  if (state === "buy-pending" || state === "iframe" || state === "post-checkout") {
    const step: AddMoneyStep = state === "post-checkout" ? "pending" : "buy";
    return (
      <div style={{ minHeight: "100svh", width: "min(100vw, 390px)" }}>
        <AddMoneyDialog
          open
          step={step}
          address={ADDRESS}
          openingOnramp={state === "buy-pending"}
          onrampError={null}
          paymentAmount="42.5"
          paymentMethod="google-pay"
          activePayment={state === "post-checkout" ? null : PAYMENT}
          inlineOnrampUrl={state === "iframe" ? "/dev/add-money-qa/frame" : null}
          inlineOnrampAttemptId={state === "iframe" ? 1 : null}
          iframeRef={frameRef}
          postCheckoutPayment={state === "post-checkout" ? POST_CHECKOUT_PAYMENT : null}
          showReceipt={false}
          signedOut={false}
          regionId="ID"
          onClose={() => {}}
          onBack={() => {}}
          onSelectReceive={() => {}}
          onSelectBuy={() => {}}
          onPaymentAmountChange={() => {}}
          onPaymentMethodChange={() => {}}
          onEditPayment={() => {}}
          onToggleReceipt={() => {}}
          onCheckBalance={() => {}}
          onContinueToCoinbase={() => {}}
        />
      </div>
    );
  }

  return (
    <AccountWalletClientProvider client={qaClient}>
      <HomeExperience
        routeMode="dashboard"
        initialAddMoney
        selectedRegionId="ID"
        assetBalances={{
          status: "ready",
          displayTotal: "$1,284.16",
          items: [
            {
              id: "usdc",
              group: "cash",
              name: "US dollar",
              displayBalance: "$1,284.16",
              currencyCode: "USD",
            },
          ],
        }}
        investContent={<section aria-label="Invest module">Invest fixture</section>}
        savingsContent={<section aria-label="Savings module">Savings fixture</section>}
      />
    </AccountWalletClientProvider>
  );
}
