import "@/client/account/dom-test-harness";

import { verifiedAccountWalletClient } from "@/tests/helpers/account-wallet";
import { page } from "@/tests/helpers/dom";
import { afterEach, describe, expect, test } from "bun:test";
import { cryptoAssets } from "@/config/invest-assets";

const { cleanup, render } = await import("@testing-library/react");
const {
  AccountWalletClientProvider,
  createBlockedAccountWalletClient,
} = await import("@/client/account/cdp-client");
const { TradeActions } = await import("./trade-actions");

const bitcoin = cryptoAssets.find((asset) => asset.id === "cbbtc")!;

afterEach(cleanup);

describe("TradeActions hosted swap availability", () => {
  test("keeps Buy and Sell disabled for verified sessions while hosted swaps are off", () => {
    render(
      <AccountWalletClientProvider client={verifiedAccountWalletClient()}>
        <TradeActions asset={bitcoin} />
      </AccountWalletClientProvider>,
    );

    expect((page().getByRole("button", { name: "Buy" }) as HTMLButtonElement).disabled).toBe(true);
    expect((page().getByRole("button", { name: "Sell" }) as HTMLButtonElement).disabled).toBe(true);
    expect(page().getByRole("note").textContent).toBe("Swaps aren't available right now.");
  });

  test("renders the same unavailable state without a verified account", () => {
    render(
      <AccountWalletClientProvider client={createBlockedAccountWalletClient("unconfigured")}>
        <TradeActions asset={bitcoin} />
      </AccountWalletClientProvider>,
    );

    expect((page().getByRole("button", { name: "Buy" }) as HTMLButtonElement).disabled).toBe(true);
    expect((page().getByRole("button", { name: "Sell" }) as HTMLButtonElement).disabled).toBe(true);
    expect(page().getByRole("note").textContent).toBe("Swaps aren't available right now.");
  });
});
