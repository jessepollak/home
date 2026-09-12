import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { afterEach, describe, expect, test } from "bun:test";
import { useState } from "react";

const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { MoneyAmountDisplay, MoneyNumpad } = await import("./amount");
const { moneyAssetPricing } = await import("./amount-units");

const usdUsdc = moneyAssetPricing("USDC", "US");
const unpricedEth = moneyAssetPricing("ETH");

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
}) {
  const [amount, setAmount] = useState("");
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
  test("toggles display units without changing the entered native amount", () => {
    render(<AmountHarness />);

    fireEvent.click(page().getByRole("button", { name: "$25" }));
    expect(document.querySelector("[data-primary-amount] [role='img']")?.getAttribute("aria-label")).toBe("$25");
    expect(page().getByLabelText("Native amount").textContent).toBe("25");

    fireEvent.click(page().getByRole("button", { name: "Show 25.00 USDC as the primary amount" }));
    expect(document.querySelector("[data-primary-amount] [role='img']")?.getAttribute("aria-label")).toBe("25");
    expect(page().getByLabelText("Native amount").textContent).toBe("25");
  });

  test("disables local quick amounts while native is primary and Max fills the available amount", () => {
    render(<AmountHarness availableAmount="1240.00" />);

    fireEvent.click(page().getByRole("button", { name: "Show 0.00 USDC as the primary amount" }));
    expect((page().getByRole("button", { name: "$10" }) as HTMLButtonElement).disabled).toBe(true);
    expect((page().getByRole("button", { name: "$25" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(page().getByRole("button", { name: "Max" }));
    expect(page().getByLabelText("Native amount").textContent).toBe("1240.00");
  });

  test("keeps a locked asset fixed and limits shortcuts to Max", () => {
    render(
      <AmountHarness
        chipSet="max"
        assetLocked
        assetOptions={[{ id: "usdc", label: "USDC" }]}
        availableAmount="1240"
      />,
    );

    expect(page().queryByLabelText("Asset")).toBeNull();
    expect(page().queryByRole("button", { name: "$10" })).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Max" }));
    expect(page().getByLabelText("Native amount").textContent).toBe("1240");
  });

  test("keeps unpriced assets in native units and fills Max losslessly", () => {
    render(
      <AmountHarness
        pricing={unpricedEth}
        nativeSymbol="ETH"
        assetId="eth"
        assetLabel="ETH"
        availableLabel="1.1010 ETH available"
        availableAmount="1.1010"
      />,
    );

    expect(page().queryByRole("button", { name: /as the primary amount/ })).toBeNull();
    expect((page().getByRole("button", { name: "$10" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(page().getByRole("button", { name: "Max" }));
    expect(page().getByLabelText("Native amount").textContent).toBe("1.1010");
  });
});
