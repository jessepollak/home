import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { StrictMode } from "react";
import type { AccountWalletClient } from "@/client/account/cdp-client";

const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const { FundingExperienceForWallet } = await import("./funding-experience");

const ADDRESS_A = "0x1111111111111111111111111111111111111111" as const;
const ADDRESS_B = "0x2222222222222222222222222222222222222222" as const;
const HOSTED_URL = "https://pay.coinbase.com/buy/select-asset?sessionToken=fixture";

type FundingWallet = Pick<
  AccountWalletClient,
  "ownerKey" | "status" | "session" | "fetchAccountResource"
>;

function hosted() {
  return {
    url: HOSTED_URL,
    asset: {
      id: "usdc",
      symbol: "USDC",
      decimals: 6,
      tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    },
    network: { name: "Base", chainId: 8453 },
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
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
});

describe("FundingExperience", () => {
  test("keeps Coinbase return routing and copies the full Base address", async () => {
    let copied = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => { copied = value; } },
    });

    render(
      <FundingExperienceForWallet
        wallet={verifiedWallet()}
        navigateToHostedOnramp={() => {}}
        returnedFromCoinbase
        regionId="ID"
      />,
    );

    expect(page().getByRole("dialog", { name: "Receive" })).toBeTruthy();
    expect(page().getByText("Receive on Base")).toBeTruthy();
    expect(page().getByText("USDC")).toBeTruthy();
    expect(page().getByText("IDRX")).toBeTruthy();
    expect(page().getByText(/other tokens in Home's supported Base inventory/)).toBeTruthy();
    expect(page().queryByRole("button", { name: "Copy address" })).toBeNull();
    expect(page().queryByRole("button", { name: "Check received" })).toBeNull();

    fireEvent.click(page().getByRole("button", { name: /Copy 0x1111…111111/ }));
    await waitFor(() => expect(copied).toBe(ADDRESS_A));
    expect(page().getByRole("button", { name: "Copied" })).toBeTruthy();
    expect(page().queryByLabelText(`Full Base address ${ADDRESS_A}`)).toBeNull();
  });

  test("offers the full selectable address when clipboard access is unavailable", async () => {
    render(
      <FundingExperienceForWallet
        wallet={verifiedWallet()}
        navigateToHostedOnramp={() => {}}
        initialStep="receive"
      />,
    );

    fireEvent.click(page().getByRole("button", { name: /Copy 0x1111…111111/ }));

    const alert = await page().findByRole("alert");
    expect(alert.textContent).toContain("Select and copy the full address below");
    const fallback = page().getByLabelText(`Full Base address ${ADDRESS_A}`);
    expect(fallback.textContent).toBe(ADDRESS_A);
    expect(fallback.getAttribute("tabindex")).toBe("0");
  });

  test("offers the full selectable address when clipboard write is rejected", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => { throw new Error("denied"); } },
    });
    render(
      <FundingExperienceForWallet
        wallet={verifiedWallet()}
        navigateToHostedOnramp={() => {}}
        initialStep="receive"
      />,
    );

    fireEvent.click(page().getByRole("button", { name: /Copy 0x1111…111111/ }));

    await waitFor(() => {
      expect(page().getByRole("alert").textContent).toContain(
        "Select and copy the full address below",
      );
    });
    expect(page().getByLabelText(`Full Base address ${ADDRESS_A}`).textContent).toBe(
      ADDRESS_A,
    );
  });

  test("does not present a disabled regional candidate as receive support", () => {
    render(
      <FundingExperienceForWallet
        wallet={verifiedWallet()}
        navigateToHostedOnramp={() => {}}
        initialStep="receive"
        regionId="BR"
      />,
    );

    expect(page().getByText("USDC")).toBeTruthy();
    expect(page().queryByText("BRZ")).toBeNull();
    expect(page().getByText(/other tokens in Home's supported Base inventory/)).toBeTruthy();
  });

  test("uses local-fiat provider headings and keeps Brazil blocked on its unresolved asset", () => {
    const cases = [
      { regionId: "AR", currency: "ARS" },
      { regionId: "CO", currency: "COP" },
      { regionId: "BR", currency: "BRL" },
    ] as const;

    for (const item of cases) {
      const rendered = render(
        <FundingExperienceForWallet
          wallet={verifiedWallet()}
          navigateToHostedOnramp={() => {}}
          regionId={item.regionId}
        />,
      );
      expect(page().queryByText("Fund this Base account")).toBeNull();
      fireEvent.click(
        page().getByRole("button", {
          name:
            item.regionId === "BR"
              ? /Ripio unavailable/
              : new RegExp(`Deposit ${item.currency}`),
        }),
      );
      const dialog = page().getByRole("dialog", {
        name: `Deposit ${item.currency}`,
      });
      expect(dialog).toBeTruthy();

      // Lock the rendered hierarchy: the dialog header (h2) carries the
      // local-fiat title, and the provider subheader (h3) sits directly below
      // it. No duplicate or inverted copy is allowed.
      const headings = within(dialog).getAllByRole("heading");
      expect(headings[0].textContent).toBe(`Deposit ${item.currency}`);
      expect(headings[0].tagName).toBe("H2");
      expect(headings[0].id).toBe("add-money-title");
      expect(
        within(dialog).getAllByRole("heading", { name: `Deposit ${item.currency}` }),
      ).toHaveLength(1);
      expect(headings[1].textContent).toBe("Use Ripio to deposit from your local bank");
      expect(headings[1].tagName).toBe("H3");
      expect(
        within(dialog).getAllByText("Use Ripio to deposit from your local bank"),
      ).toHaveLength(1);
      expect(within(dialog).queryByText("Deposit from your local account")).toBeNull();
      if (item.regionId === "BR") {
        expect(page().getByText(/does not currently expose Home's selected BRZ/)).toBeTruthy();
      }
      rendered.unmount();
    }
  });

  test("walks every synthetic Ripio review state without creating an order", () => {
    let accountRequests = 0;
    render(
      <FundingExperienceForWallet
        wallet={{
          ...verifiedWallet(),
          fetchAccountResource: async () => {
            accountRequests += 1;
            throw new Error("No request expected");
          },
        }}
        navigateToHostedOnramp={() => {}}
        regionId="AR"
      />,
    );

    expect(
      page().getByRole(
        "button",
        { name: /Deposit ARS Use Ripio to deposit from your local bank/ },
      ),
    ).toBeTruthy();
    fireEvent.click(
      page().getByRole("button", { name: /Deposit ARS/ }),
    );
    expect(page().getByRole("dialog", { name: "Deposit ARS" })).toBeTruthy();
    expect(page().getByText("Synthetic preview · no order or funds")).toBeTruthy();
    expect(page().getByRole("region", { name: "Requirements and verification" })).toBeTruthy();
    expect(page().getByText("Required; not accepted in preview")).toBeTruthy();
    expect(page().getByText("Required; not checked in preview")).toBeTruthy();

    const stages = [
      { button: "Preview quote", region: "Quote review" },
      { button: "Preview bank instructions", region: "Bank rail instructions" },
      { button: "Preview pending deposit", region: "Pending deposit" },
      { button: "Preview recovery", region: "Deposit recovery" },
      { button: "Preview refund", region: "Refund status" },
      { button: "Preview error state", region: "Provider error" },
    ];
    for (const stage of stages) {
      fireEvent.click(page().getByRole("button", { name: stage.button }));
      expect(page().getByRole("region", { name: stage.region })).toBeTruthy();
    }

    expect(page().getByRole("alert").textContent).toContain("synthetic request");
    expect(page().getByRole("button", { name: "Restart preview" })).toBeTruthy();
    expect(accountRequests).toBe(0);
  });

  test("shows only the selected-country onramp by default", () => {
    const argentina = render(
      <FundingExperienceForWallet
        wallet={verifiedWallet()}
        navigateToHostedOnramp={() => {}}
        regionId="AR"
      />,
    );
    expect(page().getByRole("button", { name: /Deposit ARS/ })).toBeTruthy();
    expect(page().getByRole("button", { name: /Use Ripio to deposit from your local bank/ })).toBeTruthy();
    expect(page().queryByRole("button", { name: /Use Coinbase/ })).toBeNull();

    argentina.unmount();
    render(
      <FundingExperienceForWallet
        wallet={verifiedWallet()}
        navigateToHostedOnramp={() => {}}
        regionId="US"
      />,
    );
    expect(page().getByRole("button", { name: /Use Coinbase to deposit USD/ })).toBeTruthy();
    expect(page().queryByRole("button", { name: /Use Ripio/ })).toBeNull();
  });

  test("searches out-of-geo providers without changing the selected country or enabling Ripio", () => {
    render(
      <FundingExperienceForWallet
        wallet={verifiedWallet()}
        navigateToHostedOnramp={() => {}}
        regionId="AR"
      />,
    );

    fireEvent.click(page().getByRole("button", { name: "Use another onramp" }));
    expect(page().getByRole("searchbox", { name: "Search onramps" })).toBeTruthy();
    expect(page().queryByText("Use Ripio to deposit ARS")).toBeNull();
    expect(page().getByText("Use Coinbase to deposit USD")).toBeTruthy();
    expect(page().queryByRole("button", { name: /Use Ripio to deposit COP/ })).toBeNull();
    expect(page().getByText("Use Ripio to deposit COP")).toBeTruthy();
    expect(page().getAllByText("Unavailable for your selected country").length).toBeGreaterThan(0);

    fireEvent.change(page().getByRole("searchbox", { name: "Search onramps" }), {
      target: { value: "COP" },
    });
    expect(page().getByText("Use Ripio to deposit COP")).toBeTruthy();
    expect(page().queryByText("Use Coinbase to deposit USD")).toBeNull();

    fireEvent.click(page().getAllByRole("button", { name: "Back" })[0]);
    expect(page().getByRole("button", { name: /Use Ripio to deposit from your local bank/ })).toBeTruthy();
    expect(page().queryByRole("button", { name: /Use Coinbase/ })).toBeNull();
  });

  test("keeps hosted navigation active after StrictMode effect replay", async () => {
    const navigations: string[] = [];
    render(
      <StrictMode>
        <FundingExperienceForWallet
          wallet={{ ...verifiedWallet(), fetchAccountResource: async () => hosted() }}
          navigateToHostedOnramp={(url) => navigations.push(url)}
          regionId="US"
        />
      </StrictMode>,
    );

    fireEvent.click(page().getByRole("button", { name: /Use Coinbase to deposit USD/ }));
    fireEvent.click(page().getByRole("button", { name: "Continue to Coinbase" }));
    await waitFor(() => expect(navigations).toEqual([HOSTED_URL]));
  });

  test("closing a pending hosted onramp prevents delayed navigation and stale persistence", async () => {
    let resolveRequest!: (value: unknown) => void;
    const pending = new Promise<unknown>((resolve) => {
      resolveRequest = resolve;
    });
    const navigations: string[] = [];
    let closes = 0;

    render(
      <FundingExperienceForWallet
        wallet={{ ...verifiedWallet(), fetchAccountResource: async () => pending }}
        navigateToHostedOnramp={(url) => navigations.push(url)}
        regionId="US"
        onClose={() => {
          closes += 1;
        }}
      />,
    );

    fireEvent.click(page().getByRole("button", { name: /Use Coinbase to deposit USD/ }));
    fireEvent.click(page().getByRole("button", { name: "Continue to Coinbase" }));
    await waitFor(() => expect(page().getByRole("button", { name: "Opening Coinbase…" })).toBeTruthy());
    fireEvent.click(page().getByRole("button", { name: "Close add money" }));

    await act(async () => {
      resolveRequest(hosted());
      await pending;
    });

    expect(closes).toBeGreaterThan(0);
    expect(navigations).toEqual([]);
    expect(window.sessionStorage.length).toBe(0);
  });

  test("unmounting a pending hosted onramp prevents delayed navigation", async () => {
    let resolveRequest!: (value: unknown) => void;
    const pending = new Promise<unknown>((resolve) => {
      resolveRequest = resolve;
    });
    const navigations: string[] = [];
    const view = render(
      <FundingExperienceForWallet
        wallet={{ ...verifiedWallet(), fetchAccountResource: async () => pending }}
        navigateToHostedOnramp={(url) => navigations.push(url)}
        regionId="US"
      />,
    );

    fireEvent.click(page().getByRole("button", { name: /Use Coinbase to deposit USD/ }));
    fireEvent.click(page().getByRole("button", { name: "Continue to Coinbase" }));
    await waitFor(() => expect(page().getByRole("button", { name: "Opening Coinbase…" })).toBeTruthy());
    view.unmount();

    await act(async () => {
      resolveRequest(hosted());
      await pending;
    });

    expect(navigations).toEqual([]);
  });

  test("hides the prior verified address as soon as the account boundary changes", () => {
    const view = render(
      <FundingExperienceForWallet
        wallet={verifiedWallet(ADDRESS_A)}
        navigateToHostedOnramp={() => {}}
        initialStep="receive"
      />,
    );
    expect(page().getByTitle(ADDRESS_A)).toBeTruthy();

    view.rerender(
      <FundingExperienceForWallet
        wallet={{ ...verifiedWallet(ADDRESS_B), status: "validating", session: null }}
        navigateToHostedOnramp={() => {}}
        initialStep="receive"
      />,
    );

    expect(page().queryByTitle(ADDRESS_A)).toBeNull();
    expect(page().getByText(/Sign in and verify a Base account/)).toBeTruthy();
  });

  test("signed-out empty state offers sign in without exposing funding actions", () => {
    render(
      <FundingExperienceForWallet
        wallet={{
          ownerKey: null,
          status: "signed-out",
          session: null,
          fetchAccountResource: async () => {
            throw new Error("signed out");
          },
        }}
        navigateToHostedOnramp={() => {}}
      />,
    );

    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe(
      "/?account=signin",
    );
    expect(page().queryByRole("button", { name: /Receive crypto/ })).toBeNull();
    expect(page().queryByRole("button", { name: "Continue to Coinbase" })).toBeNull();
  });
});
