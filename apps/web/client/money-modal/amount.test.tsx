import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { useState } from "react";

const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { MoneyAmountDisplay, MoneyNumpad } = await import("./amount");
const { moneyAssetPricing } = await import("./amount-units");

const usdUsdc = moneyAssetPricing("USDC", "US");
const unpricedEth = moneyAssetPricing("ETH");

function page() {
  return within(document.body);
}

function AmountHarness({
  chipSet = "quick-local",
  pricing = usdUsdc,
  nativeSymbol = "USDC",
  assetId = "usdc",
  assetLabel = "USDC",
  assetLocked = false,
  assetOptions = [
    { id: "usdc", label: "USDC" },
    { id: "eth", label: "ETH" },
  ],
  availableLabel = "$1,240.00 available",
  availableAmount,
  initialAmount = "",
}: {
  chipSet?: "none" | "max" | "quick-local";
  pricing?: typeof usdUsdc;
  nativeSymbol?: string;
  assetId?: string;
  assetLabel?: string;
  assetLocked?: boolean;
  assetOptions?: ReadonlyArray<{ id: string; label: string }>;
  availableLabel?: string;
  availableAmount?: string | null;
  initialAmount?: string;
}) {
  const [amount, setAmount] = useState(initialAmount);
  return (
    <>
      <MoneyAmountDisplay
        amount={amount}
        onAmountChange={setAmount}
        availableLabel={availableLabel}
        availableAmount={availableAmount}
        assetId={assetId}
        assetLabel={assetLabel}
        assetOptions={assetOptions}
        onAssetChange={() => {}}
        assetLocked={assetLocked}
        chipSet={chipSet}
        pricing={pricing}
        nativeSymbol={nativeSymbol}
      />
      <MoneyNumpad value={amount} maxDecimals={6} onChange={setAmount} />
      <output aria-label="Native amount">{amount}</output>
    </>
  );
}

afterEach(cleanup);

describe("MoneyAmountDisplay", () => {
  test("defaults to local primary and toggles display only", () => {
    render(<AmountHarness />);

    expect(page().getByText("$0")).toBeTruthy();
    expect(page().getByRole("button", { name: "Show 0.00 USDC as the primary amount" })).toBeTruthy();
    expect(page().getByText("$1,240.00 available")).toBeTruthy();
    expect((page().getByRole("button", { name: "$10" }) as HTMLButtonElement).disabled).toBe(false);
    expect((page().getByRole("button", { name: "$25" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(page().getByRole("button", { name: "$25" }));
    expect(document.querySelector("[data-primary-amount]")?.textContent).toBe("$25");
    expect(page().getByLabelText("Native amount").textContent).toBe("25");
    expect(page().getByRole("button", { name: "Show 25.00 USDC as the primary amount" })).toBeTruthy();

    fireEvent.click(page().getByRole("button", { name: "Show 25.00 USDC as the primary amount" }));
    expect(document.querySelector("[data-primary-amount]")?.textContent).toBe("25");
    expect(page().getByRole("button", { name: "Show $25.00 as the primary amount" })).toBeTruthy();
    expect(page().getByText("1,240.00 USDC available")).toBeTruthy();
    expect(page().getByLabelText("Native amount").textContent).toBe("25");
    expect((page().getByRole("button", { name: "$10" }) as HTMLButtonElement).disabled).toBe(true);
    expect((page().getByRole("button", { name: "$25" }) as HTMLButtonElement).disabled).toBe(true);
    expect((page().getByRole("button", { name: "Max" }) as HTMLButtonElement).disabled).toBe(false);
  });

  test("disables $10/$25 while native is primary and Max fills available", () => {
    render(<AmountHarness availableAmount="1240.00" />);

    fireEvent.click(page().getByRole("button", { name: "Show 0.00 USDC as the primary amount" }));
    expect((page().getByRole("button", { name: "$10" }) as HTMLButtonElement).disabled).toBe(true);
    expect((page().getByRole("button", { name: "$25" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(page().getByRole("button", { name: "Max" }));
    expect(page().getByLabelText("Native amount").textContent).toBe("1240.00");
    expect(document.querySelector("[data-primary-amount]")?.textContent).toBe("1240.00");
  });

  test("Save deposit keeps a locked asset pill and Max only", () => {
    render(
      <AmountHarness
        chipSet="max"
        assetLocked
        assetOptions={[{ id: "usdc", label: "USDC" }]}
        availableLabel="$1,240.00 available"
        availableAmount="1240"
      />,
    );

    expect(page().getByLabelText("USDC")).toBeTruthy();
    expect(page().queryByLabelText("Asset")).toBeNull();
    expect(page().queryByRole("button", { name: "$10" })).toBeNull();
    expect(page().queryByRole("button", { name: "$25" })).toBeNull();
    expect((page().getByRole("button", { name: "Max" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(page().getByRole("button", { name: "Max" }));
    expect(page().getByLabelText("Native amount").textContent).toBe("1240");
    expect(document.querySelector("[data-primary-amount]")?.textContent).toBe("$1240");
  });

  test("hides the unit toggle when the asset is unpriced", () => {
    render(
      <AmountHarness
        pricing={unpricedEth}
        nativeSymbol="ETH"
        assetId="eth"
        assetLabel="ETH"
        availableLabel="1.1010 ETH available"
      />,
    );

    expect(document.querySelector("[data-primary-amount]")?.textContent).toBe("0");
    expect(page().queryByRole("button", { name: /as the primary amount/ })).toBeNull();
    expect((page().getByRole("button", { name: "$10" }) as HTMLButtonElement).disabled).toBe(true);
    expect((page().getByRole("button", { name: "$25" }) as HTMLButtonElement).disabled).toBe(true);
    expect((page().getByRole("button", { name: "Max" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(page().getByRole("button", { name: "Max" }));
    expect(page().getByLabelText("Native amount").textContent).toBe("1.1010");
  });
});
