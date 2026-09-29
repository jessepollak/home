import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, mock, test } from "bun:test";
import { useState } from "react";

const { page } = await import("@/tests/helpers/dom");
const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { MoneyAmountDisplay, MoneyAssetPicker, matchesMoneyAssetOption, fitAmountFontSize, fitAmountText } = await import("./amount");
const { MoneyModal, MoneyModalHeader, MoneyModalStep } = await import("./money-modal");
const fiatUsd = { kind: "fiat", currency: "USD" } as const;
const native = { kind: "native" } as const;

function AmountHarness({
  chipSet = "quick-local",
  unit = fiatUsd,
  nativeSymbol = "USDC",
  assetId = "usdc",
  assetLabel = "USDC",
  assetLocked = false,
  assetOptions = [{ id: "usdc", label: "USDC" }, { id: "eth", label: "ETH" }],
  availableLabel = "$1,240.00 available",
  availableAmount,
  maxDecimals = 6,
  initialAmount = "",
  overAvailable = false,
  amountError,
  disabled = false,
  readOnly = false,
  onSubmit,
}: {
  chipSet?: "none" | "max" | "quick-local";
  unit?: import("./amount-units").MoneyAmountUnit;
  nativeSymbol?: string;
  assetId?: string;
  assetLabel?: string;
  assetLocked?: boolean;
  assetOptions?: ReadonlyArray<{ id: string; label: string; description?: string }>;
  availableLabel?: string;
  availableAmount?: string | null;
  maxDecimals?: number;
  initialAmount?: string;
  overAvailable?: boolean;
  amountError?: string;
  disabled?: boolean;
  readOnly?: boolean;
  onSubmit?: () => void;
}) {
  const [amount, setAmount] = useState(initialAmount);
  return <>
    <MoneyAmountDisplay
      amount={amount}
      onAmountChange={setAmount}
      maxDecimals={maxDecimals}
      overAvailable={overAvailable}
      amountError={amountError}
      disabled={disabled}
      readOnly={readOnly}
      onSubmit={onSubmit}
      availableLabel={availableLabel}
      availableAmount={availableAmount}
      assetId={assetId}
      assetLabel={assetLabel}
      assetOptions={assetOptions}
      onAssetChange={() => {}}
      assetLocked={assetLocked}
      chipSet={chipSet}
      unit={unit}
      nativeSymbol={nativeSymbol}
    />
    <output aria-label="Native amount">{amount}</output>
  </>;
}

function amountInput(): HTMLInputElement {
  return page().getByRole("textbox", { name: "Amount" }) as HTMLInputElement;
}

afterEach(cleanup);

function accessibleDescription(element: HTMLElement): string {
  return (element.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

test("primary amount auto-fit shrinks and clamps longer number and unit combinations", () => {
  expect(fitAmountFontSize(280, 420, 48, 20)).toBe(32);
  expect(fitAmountFontSize(280, 200, 48, 20)).toBe(48);
  expect(fitAmountFontSize(100, 1000, 48, 20)).toBe(20);
});

test("auto-fit keeps headroom, then distinguishes shrinking and minimum-size overflow", () => {
  expect(fitAmountText(300, 291, 36, 24)).toEqual({ fontSize: 36, overflows: false });
  expect(fitAmountText(300, 300, 36, 24)).toEqual({ fontSize: 34.9, overflows: false });
  expect(fitAmountText(300, 301, 36, 24)).toEqual({ fontSize: 34.8, overflows: false });
  expect(fitAmountText(300, 400, 36, 24)).toEqual({ fontSize: 26.1, overflows: false });
  expect(fitAmountText(300, 451, 36, 24)).toEqual({ fontSize: 24, overflows: true });
});

describe("MoneyAmountDisplay", () => {
  test("types exact decimal strings without a ticker on editable text", () => {
    render(<AmountHarness />);
    const input = amountInput();
    expect(input.placeholder).toBe("0");
    expect(input.inputMode).toBe("decimal");
    expect(input.hasAttribute("data-money-amount-input")).toBe(true);
    fireEvent.input(input, { target: { value: "123.456" } });
    expect(input.value).toBe("123.456");
    expect(page().getByLabelText("Native amount").textContent).toBe("123.456");
    expect(input.closest("[data-primary-amount]")?.querySelector("[data-slot='money-ticker']")).toBeNull();
    expect(accessibleDescription(input)).toBe("Currency: US dollar $1,240.00 available");
  });

  test("rejects invalid edits and restores the pre-edit caret", () => {
    render(<AmountHarness initialAmount="12.34" />);
    const input = amountInput();
    input.setSelectionRange(2, 2);
    fireEvent.keyDown(input, { key: "e" });
    fireEvent.input(input, { target: { value: "12e.34", selectionStart: 3 } });
    expect(input.value).toBe("12.34");
    expect(input.selectionStart).toBe(2);
    expect(page().getByLabelText("Native amount").textContent).toBe("12.34");
  });

  test("waits for an input-method composition to finish before validating", () => {
    render(<AmountHarness />);
    const input = amountInput();
    input.value = "1５";
    input.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
    expect(page().getByLabelText("Native amount").textContent).toBe("");
    input.value = "15";
    fireEvent.compositionEnd(input);
    expect(input.value).toBe("15");
    expect(page().getByLabelText("Native amount").textContent).toBe("15");
  });

  test("normalizes comma and leading zeros and retains the logical caret", () => {
    render(<AmountHarness />);
    const input = amountInput();
    fireEvent.input(input, { target: { value: "005,1", selectionStart: 3 } });
    expect(input.value).toBe("5.1");
    expect(input.selectionStart).toBe(1);
  });

  test("pastes grouped currency text at the selection and rejects invalid clipboard text", () => {
    render(<AmountHarness initialAmount="99" />);
    const input = amountInput();
    input.setSelectionRange(0, 2);
    fireEvent.paste(input, { clipboardData: { getData: () => "$1,234.56" } });
    expect(input.value).toBe("1234.56");
    expect(input.selectionStart).toBe(7);
    fireEvent.paste(input, { clipboardData: { getData: () => "12 USDC" } });
    expect(input.value).toBe("1234.56");
  });

  test("pastes mixed separators and currency symbols using the last separator as decimal", () => {
    render(<AmountHarness />);
    fireEvent.paste(amountInput(), { clipboardData: { getData: () => "€1.234,56" } });
    expect(amountInput().value).toBe("1234.56");
    amountInput().setSelectionRange(0, 4);
    fireEvent.paste(amountInput(), { clipboardData: { getData: () => "2" } });
    expect(amountInput().value).toBe("2.56");
    expect(amountInput().selectionStart).toBe(1);
  });

  test("enforces precision, whole digits, and integer-only assets", () => {
    render(<AmountHarness maxDecimals={2} />);
    const input = amountInput();
    fireEvent.input(input, { target: { value: "12.34" } });
    fireEvent.input(input, { target: { value: "12.345" } });
    expect(input.value).toBe("12.34");
    fireEvent.input(input, { target: { value: "1234567890123" } });
    expect(input.value).toBe("12.34");
    cleanup();
    render(<AmountHarness maxDecimals={0} />);
    fireEvent.input(amountInput(), { target: { value: "1." } });
    expect(amountInput().value).toBe("");
  });

  test("quick amounts and Max set exact strings", () => {
    render(<AmountHarness availableAmount="12.345600" />);
    fireEvent.click(page().getByRole("button", { name: "$10" }));
    expect(amountInput().value).toBe("10");
    fireEvent.click(page().getByRole("button", { name: "$25" }));
    expect(amountInput().value).toBe("12.345600");
    fireEvent.click(page().getByRole("button", { name: "Max" }));
    expect(amountInput().value).toBe("12.345600");
  });

  test("a read-only amount keeps focus and value while every shortcut is disabled", () => {
    const onSubmit = mock(() => undefined);
    render(<AmountHarness initialAmount="5" availableAmount="12" readOnly onSubmit={onSubmit} />);
    const input = amountInput();
    input.focus();
    expect(input.readOnly).toBe(true);
    expect(input.disabled).toBe(false);
    fireEvent.input(input, { target: { value: "7" } });
    fireEvent.paste(input, { clipboardData: { getData: () => "9" } });
    expect(page().getByLabelText("Native amount").textContent).toBe("5");
    expect(input.value).toBe("5");
    for (const name of ["$10", "$25", "Max"]) expect((page().getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(input);
  });

  test("a disabled amount disables Max", () => {
    render(<AmountHarness availableAmount="12" disabled />);
    expect(amountInput().disabled).toBe(true);
    expect((page().getByRole("button", { name: "Max" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("disables fiat quick amounts for native units but keeps exact Max", () => {
    render(<AmountHarness unit={native} nativeSymbol="ETH" chipSet="quick-local" availableAmount="1.1010" />);
    expect((page().getByRole("button", { name: "$10" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(page().getByRole("button", { name: "Max" }));
    expect(amountInput().value).toBe("1.1010");
  });

  test("renders step-specific notices after availability and before quick amounts", () => {
    render(
      <MoneyAmountDisplay amount="1" onAmountChange={() => {}} maxDecimals={6}
        unit={fiatUsd} nativeSymbol="USDC" availableLabel="$12.00 available" chipSet="max"
        availableAmount="12">
        <p>Step notice</p>
      </MoneyAmountDisplay>,
    );
    const available = page().getByText("$12.00 available");
    const notice = page().getByText("Step notice");
    const chips = page().getByRole("group", { name: "Quick amounts" });
    expect(available.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice.compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("keeps exact fiat entry and Max without a unit toggle", () => {
    render(<AmountHarness availableAmount="1240.00" />);
    const input = amountInput();
    fireEvent.input(input, { target: { value: "25.123456" } });
    expect(input.value).toBe("25.123456");
    expect(accessibleDescription(input)).toContain("Currency: US dollar");
    expect(page().queryByRole("button", { name: /as the primary amount/ })).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Max" }));
    expect(input.value).toBe("1240.00");
  });

  test("changes the unit and asset from an inside control while keeping the amount and input focus", async () => {
    function Journey() {
      const [cash, setCash] = useState(false);
      const [open, setOpen] = useState(false);
      return <><button type="button" onClick={() => setOpen(true)}>Open amount</button>
        <MoneyModal open={open} immediate labelledBy="asset-title" onCancel={() => setOpen(false)} onClose={() => {}}>
          <MoneyModalStep step="amount">
            <MoneyModalHeader title="Amount" titleId="asset-title" />
            <button type="button" onClick={() => setCash(true)}>Choose USDC</button>
            <AmountHarness unit={cash ? fiatUsd : native} nativeSymbol={cash ? "USDC" : "ETH"}
              assetId={cash ? "usdc" : "eth"} assetLabel={cash ? "USDC" : "ETH"} initialAmount="25.123456" />
          </MoneyModalStep>
        </MoneyModal></>;
    }
    render(<Journey />);
    await act(async () => fireEvent.click(page().getByRole("button", { name: "Open amount" })));
    const input = amountInput();
    expect(document.activeElement === input).toBe(true);
    expect(accessibleDescription(input)).toContain("Currency: ETH");
    fireEvent.click(page().getByRole("button", { name: "Choose USDC" }));
    expect(input.value).toBe("25.123456");
    expect(document.activeElement).toBe(input);
    expect(accessibleDescription(input)).toContain("Currency: US dollar");
    expect(page().queryByRole("button", { name: /as the primary amount/ })).toBeNull();
  });

  test("shows Only available as a live description and invalid input", () => {
    render(<AmountHarness overAvailable availableLabel="$12.00 available" />);
    const error = page().getByText("Only $12.00 available");
    expect(error.getAttribute("aria-live")).toBe("polite");
    expect(amountInput().getAttribute("aria-invalid")).toBe("true");
    expect(amountInput().getAttribute("aria-describedby")?.split(" ")).toContain(error.id);
    expect(accessibleDescription(amountInput())).toBe("Currency: US dollar Only $12.00 available");
  });

  test("amount error replaces the available description, including over the generic ceiling", () => {
    const errorText = "That amount needs more cbBTC than is available in this wallet.";
    const view = render(<AmountHarness amountError={errorText} availableLabel="$12.00 available" />);
    const input = amountInput();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const error = page().getByText(errorText);
    expect(error.getAttribute("aria-live")).toBe("polite");
    expect(input.getAttribute("aria-describedby")?.split(" ")).toContain(error.id);
    expect(accessibleDescription(input)).toBe(`Currency: US dollar ${errorText}`);
    view.rerender(<AmountHarness amountError={errorText} availableLabel="$12.00 available" overAvailable />);
    expect(page().queryByText("Only $12.00 available")).toBeNull();
    expect(accessibleDescription(amountInput())).toBe(`Currency: US dollar ${errorText}`);
    expect(amountInput().getAttribute("aria-invalid")).toBe("true");
    cleanup();
    render(<AmountHarness amountError={errorText} availableLabel="" />);
    expect(amountInput().getAttribute("aria-describedby")?.split(" ")).toContain(page().getByText(errorText).id);
    expect(accessibleDescription(amountInput())).toBe(`Currency: US dollar ${errorText}`);
  });

  test("reports a four-digit exact ceiling below the displayed balance with grouping", () => {
    render(<AmountHarness overAvailable availableLabel="$1,240.00 available" availableAmount="1234.56" />);
    expect(page().getByText("Only $1,234.56 available")).toBeTruthy();
    cleanup();
    render(<AmountHarness overAvailable availableLabel="1,240.00 ETH available" availableAmount="1234.5" unit={native} nativeSymbol="ETH" />);
    expect(page().getByText("Only 1,234.5 ETH available")).toBeTruthy();
  });

  test("Enter submits; only the step host focuses enabled amount inputs", async () => {
    const onSubmit = mock(() => {});
    render(<AmountHarness onSubmit={onSubmit} />);
    expect(document.activeElement).not.toBe(amountInput());
    fireEvent.keyDown(amountInput(), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    cleanup();
    function Sheet({ disabled }: { disabled: boolean }) {
      const [open, setOpen] = useState(false);
      return <><button type="button" onClick={() => setOpen(true)}>Open amount</button>
        <MoneyModal open={open} immediate labelledBy="amount-title" onCancel={() => setOpen(false)} onClose={() => {}}>
          <MoneyModalStep step="amount"><MoneyModalHeader title="Amount" titleId="amount-title" /><AmountHarness disabled={disabled} onSubmit={onSubmit} /></MoneyModalStep>
        </MoneyModal></>;
    }
    render(<Sheet disabled={false} />);
    await act(async () => fireEvent.click(page().getByRole("button", { name: "Open amount" })));
    expect(document.activeElement === amountInput()).toBe(true);
    cleanup();
    render(<Sheet disabled />);
    await act(async () => fireEvent.click(page().getByRole("button", { name: "Open amount" })));
    expect(amountInput().disabled).toBe(true);
    expect(document.activeElement).not.toBe(amountInput());
  });

  test("Enter that commits an input-method composition does not submit", () => {
    const onSubmit = mock(() => {});
    render(<AmountHarness onSubmit={onSubmit} />);
    fireEvent.keyDown(amountInput(), { key: "Enter", isComposing: true });
    fireEvent.keyDown(amountInput(), { key: "Enter", keyCode: 229 });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(amountInput(), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test("keeps a read-only amount as text and renders unpriced native amounts", () => {
    render(<MoneyAmountDisplay amount="1.1010" maxDecimals={18} unit={native} nativeSymbol="ETH" />);
    expect(page().queryByRole("textbox", { name: "Amount" })).toBeNull();
    expect(page().getAllByText("1.1010 ETH").length).toBeGreaterThan(0);
    cleanup();
    render(<AmountHarness unit={native} nativeSymbol="ETH" availableLabel="1.1010 ETH available" availableAmount="1.1010" />);
    expect(page().queryByRole("button", { name: /as the primary amount/ })).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Max" }));
    expect(amountInput().value).toBe("1.1010");
  });

  test("renders fiat formatting outside the editable field", () => {
    render(<AmountHarness unit={{ kind: "fiat", currency: "IDR" }} initialAmount="123.45" maxDecimals={2} />);
    expect(amountInput().value).toBe("123.45");
    expect(amountInput().closest("label")?.textContent).toContain("Rp");
  });

  test("announces the fiat currency when no availability line describes the field", () => {
    render(<AmountHarness unit={{ kind: "fiat", currency: "IDR" }} availableLabel="" chipSet="none" />);
    expect(accessibleDescription(amountInput())).toBe("Currency: Rupiah");
  });

  test("announces the native unit for an unpriced asset", () => {
    render(<AmountHarness unit={native} nativeSymbol="ETH" availableLabel="" chipSet="none" />);
    expect(accessibleDescription(amountInput())).toBe("Currency: ETH");
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
    const selectorMarks = document.querySelectorAll("[data-presentation='selector']");
    expect(selectorMarks.length).toBeGreaterThanOrEqual(2);
    for (const mark of selectorMarks) {
      expect(mark.getAttribute("data-size")).toBe("default");
      expect(mark.querySelector("[data-mark-inner]")).toBeTruthy();
    }

    fireEvent.click(option);

    await waitFor(() => expect(onAssetChange).toHaveBeenCalledWith("eurc"));
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
    render(<AmountHarness chipSet="max" assetLocked availableAmount="1240" />);
    expect(page().getByRole("group", { name: "USDC" })).toBeTruthy();
    expect(page().queryByRole("combobox", { name: "Asset" })).toBeNull();
    expect(page().queryByRole("button", { name: "$10" })).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Max" }));
    expect(amountInput().value).toBe("1240");
  });
});

const pricedBtc = { kind: "convertible", currency: "USD", perUnit: { atoms: "65000", scale: 0 } } as const;

function primaryToggle(): HTMLButtonElement {
  return page().getByRole("button", { name: /as the primary amount/ }) as HTMLButtonElement;
}

describe("priced amount toggle", () => {
  test("shows a secondary fiat label below native availability without altering the native amount", () => {
    render(<AmountHarness unit={pricedBtc} nativeSymbol="cbBTC" assetId="btc" assetLabel="cbBTC"
      initialAmount="0.001" availableAmount="0.02" availableLabel="0.02 cbBTC available" maxDecimals={8} />);
    const input = amountInput();
    expect(input.value).toBe("0.001");
    expect(primaryToggle().getAttribute("aria-label")).toBe("Show ≈ $65.00 as the primary amount");
    expect(page().getByText("0.02 cbBTC available").compareDocumentPosition(primaryToggle()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(accessibleDescription(input)).toContain("Currency: cbBTC");
    expect((page().getByRole("button", { name: "$10" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(primaryToggle());
    expect(amountInput()).toBe(input);
    expect(input.value).toBe("65.00");
    expect(page().getByLabelText("Native amount").textContent).toBe("0.001");
    expect(primaryToggle().getAttribute("aria-label")).toBe("Show 0.001 cbBTC as the primary amount");
    expect(accessibleDescription(input)).toContain("Currency: US dollar");
    expect(page().getByText("0.02 cbBTC available")).toBeTruthy();
    expect((page().getByRole("button", { name: "$10" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(primaryToggle());
    expect(input.value).toBe("0.001");
    expect(page().getByLabelText("Native amount").textContent).toBe("0.001");
  });

  test("typing fiat emits exact floored native while retaining the typed fiat string", () => {
    render(<AmountHarness unit={pricedBtc} nativeSymbol="cbBTC" assetId="btc" assetLabel="cbBTC"
      availableAmount="0.05" availableLabel="0.05 cbBTC available" maxDecimals={8} />);
    fireEvent.click(primaryToggle());
    const input = amountInput();
    fireEvent.input(input, { target: { value: "100.00" } });
    expect(input.value).toBe("100.00");
    expect(page().getByLabelText("Native amount").textContent).toBe("0.00153846");
    expect(primaryToggle().getAttribute("aria-label")).toBe("Show 0.00153846 cbBTC as the primary amount");
    fireEvent.input(input, { target: { value: "100.001" } });
    expect(input.value).toBe("100.00");
    fireEvent.click(page().getByRole("button", { name: "$10" }));
    expect(input.value).toBe("10");
    expect(page().getByLabelText("Native amount").textContent).toBe("0.00015384");
  });

  test("Max in fiat mode emits exact native max and derives floored fiat", () => {
    render(<AmountHarness unit={pricedBtc} nativeSymbol="cbBTC" assetId="btc" assetLabel="cbBTC"
      availableAmount="0.12345678" availableLabel="0.12345678 cbBTC available" maxDecimals={8} />);
    fireEvent.click(primaryToggle());
    fireEvent.input(amountInput(), { target: { value: "100.00" } });
    fireEvent.click(page().getByRole("button", { name: "Max" }));
    expect(page().getByLabelText("Native amount").textContent).toBe("0.12345678");
    expect(amountInput().value).toBe("8024.69");
  });

  test("Max derives fiat even when the exact native max equals the typed fiat result", () => {
    render(<AmountHarness unit={pricedBtc} nativeSymbol="cbBTC" assetId="btc" assetLabel="cbBTC"
      availableAmount="0.00153846" availableLabel="0.00153846 cbBTC available" maxDecimals={8} />);
    fireEvent.click(primaryToggle());
    fireEvent.input(amountInput(), { target: { value: "100.00" } });
    expect(amountInput().value).toBe("100.00");
    fireEvent.click(page().getByRole("button", { name: "Max" }));
    expect(page().getByLabelText("Native amount").textContent).toBe("0.00153846");
    expect(amountInput().value).toBe("99.99");
  });

  test("asset change resets mode, and a unit becoming native hides toggle and restores native entry", () => {
    const props = { nativeSymbol: "cbBTC", assetId: "btc", assetLabel: "cbBTC", initialAmount: "0.001", maxDecimals: 8,
      availableAmount: "0.02", availableLabel: "0.02 cbBTC available" };
    const view = render(<AmountHarness {...props} unit={pricedBtc} />);
    fireEvent.click(primaryToggle());
    expect(amountInput().value).toBe("65.00");
    view.rerender(<AmountHarness {...props} assetId="other" unit={pricedBtc} />);
    expect(amountInput().value).toBe("0.001");
    fireEvent.click(primaryToggle());
    view.rerender(<AmountHarness {...props} assetId="other" unit={native} />);
    expect(amountInput().value).toBe("0.001");
    expect(page().queryByRole("button", { name: /as the primary amount/ })).toBeNull();
    expect(accessibleDescription(amountInput())).toContain("Currency: cbBTC");
    view.rerender(<AmountHarness {...props} assetId="other" unit={pricedBtc} />);
    expect(amountInput().value).toBe("0.001");
  });

  test("the native unit's Only available line stays exact in fiat mode", () => {
    render(<AmountHarness unit={pricedBtc} nativeSymbol="cbBTC" assetId="btc" assetLabel="cbBTC"
      overAvailable initialAmount="0.03" availableAmount="0.01999999" availableLabel="0.02 cbBTC available" maxDecimals={8} />);
    expect(page().getByText("Only 0.01999999 cbBTC available")).toBeTruthy();
    fireEvent.click(primaryToggle());
    expect(page().getByText("Only 0.01999999 cbBTC available")).toBeTruthy();
  });
});
