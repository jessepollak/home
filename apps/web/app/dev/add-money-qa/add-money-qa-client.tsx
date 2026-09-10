"use client";

import { HomeExperience } from "@/app/home-experience";
import {
  AccountWalletClientProvider,
  createBlockedAccountWalletClient,
  type AccountWalletClient,
} from "@/features/account/cdp-client";
import { BASE_CHAIN_ID } from "@/features/account/session-types";

const ADDRESS = "0x22111d000000000000000000000000000077daa9" as const;

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
