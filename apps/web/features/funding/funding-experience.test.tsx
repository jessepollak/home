import "@/features/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { StrictMode } from "react";
import type { AccountWalletClient } from "@/features/account/cdp-client";
import { FUNDING_ATTEMPT_STORAGE_KEY } from "./funding-client";

const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const { FundingExperienceForWallet } = await import("./funding-experience");

const ADDRESS_A = "0x1111111111111111111111111111111111111111" as const;
const ADDRESS_B = "0x2222222222222222222222222222222222222222" as const;

type FundingWallet = Pick<
  AccountWalletClient,
  | "ownerKey"
  | "status"
  | "session"
  | "fetchPortfolio"
  | "fetchActivity"
  | "fetchAccountResource"
>;

function portfolio(address: `0x${string}`, usdc = "1000000") {
  return {
    walletAddress: address,
    chainId: 8453,
    blockNumber: "100",
    blockHash: `0x${"a".repeat(64)}`,
    blockTimestamp: "1788861600",
    fetchedAt: "2026-09-08T10:00:00.000Z",
    assets: [
      {
        id: "usdc",
        symbol: "USDC",
        decimals: 6,
        kind: "erc20",
        tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        balanceBaseUnits: usdc,
      },
      {
        id: "eth",
        symbol: "ETH",
        decimals: 18,
        kind: "native",
        balanceBaseUnits: "0",
      },
    ],
  };
}

function verifiedWallet(address: `0x${string}` = ADDRESS_A): FundingWallet {
  return {
    ownerKey: `owner-${address}`,
    status: "verified",
    session: {
      user: { subject: `subject-${address}` },
      smartAccount: { address, chainId: 8453 },
      accountProvider: "base-account",
    },
    fetchPortfolio: async () => portfolio(address),
    fetchActivity: async () => {
      throw new Error("activity not configured");
    },
    fetchAccountResource: async () => {
      throw new Error("hosted funding fixture not configured");
    },
  };
}

function page() {
  return within(document.body);
}

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe("FundingExperience", () => {
  test("treats a Coinbase return as unconfirmed and checks only verified balances", async () => {
    window.sessionStorage.setItem(
      FUNDING_ATTEMPT_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        accountProvider: "base-account",
        address: ADDRESS_A,
        startedAt: "2026-09-08T09:00:00.000Z",
        baselineUsdcBaseUnits: "1000000",
      }),
    );

    render(
      <FundingExperienceForWallet
        wallet={verifiedWallet()}
        navigateToHostedOnramp={() => {}}
        returnedFromCoinbase
      />,
    );

    expect(page().getByText(/Returning does not confirm a purchase or deposit/)).toBeTruthy();
    await waitFor(() =>
      expect(page().getByText(/No increase in the supported Base balances was found/)).toBeTruthy(),
    );
    expect(page().queryByText(/Deposit confirmed/i)).toBeNull();
    expect(page().getByText(ADDRESS_A)).toBeTruthy();
  });

  test("keeps hosted navigation active after StrictMode effect replay", async () => {
    const navigations: string[] = [];
    render(
      <StrictMode>
        <FundingExperienceForWallet
          wallet={{
            ...verifiedWallet(),
            fetchAccountResource: async () => ({
              url: "https://pay.coinbase.com/buy/select-asset?sessionToken=fresh-account",
              asset: {
                id: "usdc",
                symbol: "USDC",
                decimals: 6,
                tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
              },
              network: { name: "Base", chainId: 8453 },
            }),
          }}
          navigateToHostedOnramp={(url) => navigations.push(url)}
        />
      </StrictMode>,
    );

    fireEvent.click(page().getByRole("button", { name: "Continue to Coinbase" }));
    await waitFor(() => expect(navigations).toEqual([
      "https://pay.coinbase.com/buy/select-asset?sessionToken=fresh-account",
    ]));
  });

  test("does not navigate to an old account's hosted session after the account changes", async () => {
    let resolveRequest!: (response: Response) => void;
    const requestPending = new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
    const navigations: string[] = [];
    const view = render(
      <FundingExperienceForWallet
        wallet={{
          ...verifiedWallet(ADDRESS_A),
          fetchAccountResource: async () =>
            requestPending.then((response) => response.json()),
        }}
        navigateToHostedOnramp={(url) => navigations.push(url)}
      />,
    );

    fireEvent.click(page().getByRole("button", { name: "Continue to Coinbase" }));
    await waitFor(() =>
      expect(page().getByRole("button", { name: "Opening Coinbase…" })).toBeTruthy(),
    );
    view.rerender(
      <FundingExperienceForWallet
        wallet={{ ...verifiedWallet(ADDRESS_B), status: "validating", session: null }}
        navigateToHostedOnramp={(url) => navigations.push(url)}
      />,
    );

    await act(async () => {
      resolveRequest(
        Response.json({
          url: "https://pay.coinbase.com/buy/select-asset?sessionToken=old-account",
          asset: {
            id: "usdc",
            symbol: "USDC",
            decimals: 6,
            tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          },
          network: { name: "Base", chainId: 8453 },
        }),
      );
      await requestPending;
    });

    expect(navigations).toEqual([]);
    expect(window.sessionStorage.getItem(FUNDING_ATTEMPT_STORAGE_KEY)).toBeNull();
  });

  test("hides the prior verified address as soon as the account boundary changes", async () => {
    const view = render(
      <FundingExperienceForWallet
        wallet={verifiedWallet(ADDRESS_A)}
        navigateToHostedOnramp={() => {}}
      />,
    );
    expect(page().getByText(ADDRESS_A)).toBeTruthy();

    view.rerender(
      <FundingExperienceForWallet
        wallet={{ ...verifiedWallet(ADDRESS_B), status: "validating", session: null }}
        navigateToHostedOnramp={() => {}}
      />,
    );

    expect(page().queryByText(ADDRESS_A)).toBeNull();
    expect(page().getByText(/Sign in and verify a Base account/)).toBeTruthy();
  });

  test("signed-out empty state links Sign in to the landing account entry", () => {
    render(
      <FundingExperienceForWallet
        wallet={{
          ownerKey: null,
          status: "signed-out",
          session: null,
          fetchPortfolio: async () => {
            throw new Error("signed out");
          },
          fetchActivity: async () => {
            throw new Error("signed out");
          },
          fetchAccountResource: async () => {
            throw new Error("signed out");
          },
        }}
        navigateToHostedOnramp={() => {}}
      />,
    );

    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().getByText(/Sign in and verify a Base account/)).toBeTruthy();
    expect(page().getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe(
      "/?account=signin",
    );
    expect(page().getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/");
    expect(page().getByRole("link", { name: "← Home" }).getAttribute("href")).toBe("/");
    expect(page().queryByRole("button", { name: "Copy address" })).toBeNull();
    expect(page().queryByRole("button", { name: "Continue to Coinbase" })).toBeNull();
    expect(page().queryByText(ADDRESS_A)).toBeNull();
  });
});
