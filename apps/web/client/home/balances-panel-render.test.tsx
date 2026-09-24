import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, within } from "@testing-library/react";
import { buildBalancesSnapshotFixture, priced, ready, unavailableBalance } from "@/shared/balances/fixtures";
import { presentBalances } from "@/shared/balances/present";
import { BalancesPage } from "./balances-panel";

const pageProps = {
  active: true,
  showSmallBalances: false,
  revealSmallBalances: false,
  onRevealSmallBalancesChange: () => undefined,
  isChecking: false,
  revealedCount: 10,
  onRevealMore: () => undefined,
};

describe("BalancesPage status", () => {
  afterEach(cleanup);

  test("labels a partial total even when no visible row is unavailable", () => {
    const partial = presentBalances({
      status: "ready",
      snapshot: buildBalancesSnapshotFixture({
        registry: {
          usdc: { balance: ready("1000000"), value: priced("USD", "1") },
          eth: { balance: unavailableBalance, value: { status: "unavailable" } },
        },
      }),
      error: null,
    });
    expect(partial.totalStatus).toBe("partial");
    const view = render(<BalancesPage {...pageProps} assetBalances={partial} />);
    const money = within(view.getByRole("region", { name: "Your money" }));

    expect(money.queryByRole("img", { name: "Unavailable" })).toBeNull();
    expect(money.getByText("Partial").getAttribute("data-total-status")).toBe("partial");
  });

  test("labels a partial total alongside an unavailable row, and keeps other status prompts", () => {
    const partial = presentBalances({
      status: "ready",
      snapshot: buildBalancesSnapshotFixture({
        registry: {
          usdc: { balance: unavailableBalance, value: { status: "unavailable" }, cashValue: { status: "unavailable" } },
          eth: { balance: ready("1000000000000000000"), value: priced("USD", "100") },
        },
      }),
      error: null,
    });
    expect(partial.totalStatus).toBe("partial");
    const view = render(<BalancesPage {...pageProps} assetBalances={partial} />);
    const money = within(view.getByRole("region", { name: "Your money" }));

    expect(money.getByText("Partial")).toBeTruthy();
    expect(money.getByRole("img", { name: "Unavailable" })).toBeTruthy();

    view.rerender(<BalancesPage
      {...pageProps}
      assetBalances={presentBalances({ status: "error", snapshot: null, error: "balances-unavailable" })}
    />);
    expect(money.getByText("Balance unavailable")).toBeTruthy();

    view.rerender(<BalancesPage
      {...pageProps}
      assetBalances={presentBalances({
        status: "ready",
        snapshot: buildBalancesSnapshotFixture({ region: "GLOBAL" }),
        error: null,
      })}
    />);
    expect(money.getByText("Choose a country in Account to set how money is shown")).toBeTruthy();
  });
});
