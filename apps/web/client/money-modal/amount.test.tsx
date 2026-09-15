import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { useState } from "react";
import type { MoneyAmountChangeSource } from "./amount";

const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const {
  MoneyAmountDisplay,
  MoneyAssetPicker,
  matchesMoneyAssetOption,
  MoneyNumpad,
  shouldAnimatePrimaryAmount,
} = await import("./amount");
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
  availableSuffix,
}: {
  chipSet?: "none" | "max" | "quick-local";
  pricing?: typeof usdUsdc;
  nativeSymbol?: string;
  assetId?: string;
  assetLabel?: string;
  assetLocked?: boolean;
  assetOptions?: ReadonlyArray<{ id: string; label: string; description?: string }>;
  availableLabel?: string;
  availableAmount?: string | null;
  availableSuffix?: string;
}) {
  const [amount, setAmount] = useState("");
  const [amountChangeSource, setAmountChangeSource] =
    useState<MoneyAmountChangeSource>("programmatic");
  const changeAmount = (value: string, source: MoneyAmountChangeSource) => {
    setAmountChangeSource(source);
    setAmount(value);
  };
  return (
    <>
      <MoneyAmountDisplay
        amount={amount}
        amountChangeSource={amountChangeSource}
        onAmountChange={changeAmount}
        availableLabel={availableLabel}
        availableAmount={availableAmount}
        availableSuffix={availableSuffix}
        assetId={assetId}
        assetLabel={assetLabel}
        assetOptions={assetOptions}
        onAssetChange={() => {}}
        assetLocked={assetLocked}
        chipSet={chipSet}
        pricing={pricing}
        nativeSymbol={nativeSymbol}
      />
      <MoneyNumpad value={amount} maxDecimals={6} onChange={changeAmount} />
      <output aria-label="Native amount">{amount}</output>
    </>
  );
}

afterEach(cleanup);

test("primary amount animation follows the authored change source", () => {
  const cases: ReadonlyArray<{
    name: string;
    previousAmount: string;
    amount: string;
    source: MoneyAmountChangeSource;
    expected: boolean;
  }> = [
    { name: "initial display", previousAmount: "", amount: "", source: "programmatic", expected: true },
    { name: "keypad digit", previousAmount: "1", amount: "12", source: "keypad", expected: false },
    { name: "keypad delete", previousAmount: "12", amount: "1", source: "keypad", expected: false },
    { name: "quick amount", previousAmount: "1", amount: "25", source: "programmatic", expected: true },
    { name: "unit toggle", previousAmount: "25", amount: "25", source: "keypad", expected: true },
  ];

  for (const { name, previousAmount, amount, source, expected } of cases) {
    expect(shouldAnimatePrimaryAmount(previousAmount, amount, source), name).toBe(expected);
  }
});

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

  test("centers a non-reserving primary ticker without a synthetic character width", () => {
    render(<AmountHarness />);

    const ticker = document.querySelector<HTMLElement>(
      "[data-primary-amount] [data-slot='money-ticker']",
    );
    expect(ticker?.style.minInlineSize).toBe("");
  });

  test("centers the available amount without a synthetic character width", () => {
    render(<AmountHarness />);

    const ticker = document.querySelector<HTMLElement>(
      "[data-slot='money-ticker'][aria-label='$1,240.00 available']",
    );
    expect(ticker?.style.minInlineSize).toBe("");
    expect(ticker?.dataset.reserveDigits).toBe("false");
  });

  test("renders currency codes before stablecoin tickers, searches all labels, and uses small marks", async () => {
    const usdc = {
      id: "usdc",
      label: "USDC",
      description: "US dollar",
      currency: "USD",
      mark: {
        assetKey: "usdc",
        name: "US dollar",
        symbol: "USDC",
        imageUrl: null,
        pending: false,
        currency: "USD",
      },
    };
    const euro = {
      id: "eurc",
      label: "EURC",
      description: "Euro",
      currency: "EUR",
      mark: {
        assetKey: "eurc",
        name: "Euro",
        symbol: "EURC",
        imageUrl: null,
        pending: false,
        currency: "EUR",
      },
    };
    expect(matchesMoneyAssetOption(euro, "Euro")).toBe(true);
    expect(matchesMoneyAssetOption(euro, "eurc")).toBe(true);
    expect(matchesMoneyAssetOption(euro, "EUR")).toBe(true);
    expect(matchesMoneyAssetOption(euro, "dollar")).toBe(false);

    const onAssetChange = mock(() => {});
    const view = render(
      <MoneyAssetPicker
        assetId="usdc"
        assetLabel="USDC"
        assetCurrency="USD"
        assetOptions={[usdc, euro]}
        onAssetChange={onAssetChange}
      />,
    );
    const input = view.getByRole("combobox", { name: "Asset" });
    expect((input as HTMLInputElement).value).toBe("USD");
    const trigger = input.parentElement?.querySelector("button");
    expect(trigger).toBeTruthy();

    fireEvent.click(trigger!);
    await waitFor(() => expect(input.getAttribute("aria-expanded")).toBe("true"));
    const option = await view.findByRole("option", { name: "EUR EURC" });
    expect(option.textContent).toBe("EUREURC");
    expect(document.querySelectorAll("[data-size='sm']").length).toBeGreaterThanOrEqual(2);

    fireEvent.click(option);

    await waitFor(() => expect(onAssetChange).toHaveBeenCalledWith("eurc"));
  });

  test("disables local quick amounts while native is primary and Max fills the available amount", () => {
    render(<AmountHarness availableAmount="1240.00" />);

    fireEvent.click(page().getByRole("button", { name: "Show 0.00 USDC as the primary amount" }));
    expect((page().getByRole("button", { name: "$10" }) as HTMLButtonElement).disabled).toBe(true);
    expect((page().getByRole("button", { name: "$25" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(page().getByRole("button", { name: "Max" }));
    expect(page().getByLabelText("Native amount").textContent).toBe("1240.00");
  });

  test("renders an available suffix without changing the exact Max amount", () => {
    render(
      <AmountHarness
        availableAmount="1240.00"
        availableSuffix="Updated 3 min ago"
      />,
    );

    expect(page().getByText("Updated 3 min ago", { exact: false })).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Max" }));
    expect(page().getByLabelText("Native amount").textContent).toBe("1240.00");
  });

  test("renders canonical locked marks with loaded, pending, broken-image, and legacy Save fallbacks", () => {
    const canonicalMark = {
      assetKey: "eip155:8453/erc20:0xcbbtc",
      name: "Bitcoin",
      symbol: "BT",
      imageUrl: "https://assets.example/cbbtc.png",
      pending: false,
      currency: null,
    };
    const view = render(
      <MoneyAssetPicker assetId="cbbtc" assetLabel="cbBTC" assetMark={canonicalMark} locked />,
    );
    const locked = view.getByLabelText("cbBTC");
    const image = locked.querySelector("img")!;
    expect(image.getAttribute("src")).toBe(canonicalMark.imageUrl);
    fireEvent.load(image);
    expect(locked.querySelector("[data-mark='image']")).toBeTruthy();

    view.rerender(
      <MoneyAssetPicker
        assetId="cbbtc"
        assetLabel="cbBTC"
        assetMark={{ ...canonicalMark, imageUrl: null, pending: true }}
        locked
      />,
    );
    expect(view.getByLabelText("cbBTC").querySelector("[data-mark='shimmer']")).toBeTruthy();

    view.rerender(<MoneyAssetPicker assetId="cbbtc" assetLabel="cbBTC" assetMark={canonicalMark} locked />);
    const brokenImage = view.getByLabelText("cbBTC").querySelector("img")!;
    fireEvent.error(brokenImage);
    expect(view.getByLabelText("cbBTC").querySelector("[data-mark='symbol']")?.textContent).toBe("BT");

    view.rerender(<MoneyAssetPicker assetId="usdc" assetLabel="USDC" locked />);
    expect(view.getByLabelText("USDC").querySelector("img")?.getAttribute("src")).toBe("/currency-flags/us.svg");
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
