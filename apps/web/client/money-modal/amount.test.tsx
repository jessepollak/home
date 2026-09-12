import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { useState, type ReactElement } from "react";

const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const {
  MoneyAmountDisplay,
  MoneyNumpad,
  fitAmountFontSize,
  triggerKeyHaptic,
} = await import("./amount");
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

    expect(document.querySelector("[data-primary-amount]")?.textContent).toBe("$0");
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

function FitOnlyHarness({ amount }: { amount: string }) {
  return (
    <MoneyAmountDisplay
      amount={amount}
      availableLabel="$1,240.00 available"
      assetId="usdc"
      assetLabel="USDC"
      assetLocked
      pricing={usdUsdc}
      nativeSymbol="USDC"
    />
  );
}

function InteractiveFitHarness() {
  const [amount, setAmount] = useState("");
  return (
    <>
      <MoneyAmountDisplay
        amount={amount}
        onAmountChange={setAmount}
        availableLabel="$1,240.00 available"
        availableAmount="1240"
        assetId="usdc"
        assetLabel="USDC"
        assetLocked
        chipSet="max"
        pricing={usdUsdc}
        nativeSymbol="USDC"
      />
      <MoneyNumpad value={amount} maxDecimals={6} onChange={setAmount} />
    </>
  );
}

function NumpadHarness({
  maxDecimals = 6,
  initial = "",
  disabled = false,
}: {
  maxDecimals?: number;
  initial?: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <MoneyNumpad
        value={value}
        maxDecimals={maxDecimals}
        onChange={setValue}
        disabled={disabled}
      />
      <output aria-label="Native amount">{value}</output>
    </>
  );
}

class CapturedResizeObserver {
  static instances: CapturedResizeObserver[] = [];
  callback: (entries: unknown[]) => void;
  disconnected = false;

  constructor(callback: (entries: unknown[]) => void) {
    this.callback = callback;
    CapturedResizeObserver.instances.push(this);
  }

  observe() {}
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
}

function mountFit(ui: ReactElement) {
  const previousResizeObserver = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  const previousGetComputedStyle = window.getComputedStyle;

  CapturedResizeObserver.instances.length = 0;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
    CapturedResizeObserver as unknown as typeof ResizeObserver;
  window.getComputedStyle = (() => ({
    fontSize: "57.6px",
    paddingLeft: "16px",
    paddingRight: "16px",
    getPropertyValue: (property: string) =>
      property === "--money-amount-min-size" ? "20px" : "",
  })) as unknown as typeof window.getComputedStyle;

  const result = render(ui);
  const amountNode = document.querySelector("[data-primary-amount]") as HTMLElement;
  const sizerNode = document.querySelector("[data-amount-sizer]") as HTMLElement;

  function setLayout(available: number, natural: number | ((text: string) => number)) {
    Object.defineProperty(amountNode, "clientWidth", {
      value: available,
      configurable: true,
    });
    sizerNode.getBoundingClientRect = () => {
      const width =
        typeof natural === "function" ? natural(sizerNode.textContent ?? "") : natural;
      return { width } as DOMRect;
    };
  }

  function flushFit() {
    act(() => {
      for (const observer of CapturedResizeObserver.instances) {
        if (!observer.disconnected) observer.callback([]);
      }
    });
  }

  return {
    result,
    amountNode,
    sizerNode,
    setLayout,
    flushFit,
    cleanup() {
      result.unmount();
      CapturedResizeObserver.instances.length = 0;
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = previousResizeObserver;
      window.getComputedStyle = previousGetComputedStyle;
    },
  };
}

function stubReducedMotion(enabled: boolean) {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: enabled && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false; },
  })) as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

function stubVibration() {
  const original = Object.getOwnPropertyDescriptor(navigator, "vibrate");
  let count = 0;
  let pattern: unknown;
  Object.defineProperty(navigator, "vibrate", {
    configurable: true,
    value: (next: unknown) => {
      count += 1;
      pattern = next;
      return true;
    },
  });
  return {
    get count() { return count; },
    get pattern() { return pattern; },
    restore() {
      if (original) Object.defineProperty(navigator, "vibrate", original);
      else Reflect.deleteProperty(navigator, "vibrate");
    },
  };
}

describe("fitAmountFontSize", () => {
  test("keeps values that already fit at the base size", () => {
    expect(fitAmountFontSize(320, 300, 50, 20)).toBe(50);
    expect(fitAmountFontSize(320, 320, 50, 20)).toBe(50);
  });

  test("shrinks proportionally without rounding or abbreviating the value", () => {
    expect(fitAmountFontSize(280, 560, 50, 20)).toBe(25);
    expect(fitAmountFontSize(350, 700, 57.6, 20)).toBe(28.8);
  });

  test("clamps to the accessible minimum and never exceeds the base", () => {
    expect(fitAmountFontSize(280, 10000, 50, 20)).toBe(20);
    expect(fitAmountFontSize(280, 10000, 50, 60)).toBe(50);
  });

  test("treats unmeasurable inputs as an unchanged base size", () => {
    expect(fitAmountFontSize(0, 500, 50, 20)).toBe(50);
    expect(fitAmountFontSize(280, 0, 50, 20)).toBe(50);
  });
});

describe("MoneyPrimaryAmount auto-fit", () => {
  test("auto-fits a long amount without changing the full value", () => {
    const harness = mountFit(<FitOnlyHarness amount="123456789012.123456" />);
    try {
      harness.setLayout(280, 600);
      harness.flushFit();
      expect(harness.amountNode.textContent).toBe("$123456789012.123456");
      expect(harness.amountNode.style.fontSize).toBe("23px");
      expect(harness.sizerNode.textContent).toBe("$123456789012.123456");
    } finally {
      harness.cleanup();
    }
  });

  test("grows back after deleting digits without clipping", () => {
    const harness = mountFit(<FitOnlyHarness amount="123456789012.123456" />);
    try {
      harness.setLayout(280, 600);
      harness.flushFit();
      expect(harness.amountNode.style.fontSize).toBe("23px");

      harness.result.rerender(<FitOnlyHarness amount="12" />);
      harness.setLayout(280, 40);
      harness.flushFit();
      expect(harness.amountNode.textContent).toBe("$12");
      expect(harness.amountNode.style.fontSize).toBe("57.6px");
    } finally {
      harness.cleanup();
    }
  });

  test("recomputes for unit toggle and the native symbol-less display", () => {
    const harness = mountFit(<FitOnlyHarness amount="123456789012.123456" />);
    try {
      harness.setLayout(280, 600);
      harness.flushFit();
      expect(harness.amountNode.textContent).toBe("$123456789012.123456");

      harness.setLayout(280, 560);
      fireEvent.click(page().getByRole("button", { name: /as the primary amount/ }));
      harness.flushFit();
      expect(harness.amountNode.textContent).toBe("123456789012.123456");
      expect(harness.amountNode.style.fontSize).toBe("24.7px");
    } finally {
      harness.cleanup();
    }
  });

  test("recomputes on every accepted input and delete", () => {
    const harness = mountFit(<InteractiveFitHarness />);
    try {
      harness.setLayout(100, (text) => text.length * 30);
      harness.flushFit();
      expect(harness.amountNode.textContent).toBe("$0");

      fireEvent.click(page().getByRole("button", { name: "1" }));
      fireEvent.click(page().getByRole("button", { name: "2" }));
      expect(harness.amountNode.textContent).toBe("$12");
      expect(harness.amountNode.style.fontSize).toBe("42.2px");

      fireEvent.click(page().getByRole("button", { name: "3" }));
      expect(harness.amountNode.textContent).toBe("$123");
      expect(harness.amountNode.style.fontSize).toBe("31.6px");

      fireEvent.click(page().getByRole("button", { name: "Delete last digit" }));
      expect(harness.amountNode.textContent).toBe("$12");
      expect(harness.amountNode.style.fontSize).toBe("42.2px");
    } finally {
      harness.cleanup();
    }
  });
});

describe("keypad pressed state and haptics", () => {


  test("vibrates once for an accepted key and stays silent for a rejected key", () => {
    const vibration = stubVibration();
    const restoreMotion = stubReducedMotion(false);
    try {
      render(<NumpadHarness maxDecimals={0} />);
      fireEvent.click(page().getByRole("button", { name: "5" }));
      expect(page().getByLabelText("Native amount").textContent).toBe("5");
      expect(vibration.count).toBe(1);
      expect(vibration.pattern).toBe(12);

      fireEvent.click(page().getByRole("button", { name: "Decimal point" }));
      expect(page().getByLabelText("Native amount").textContent).toBe("5");
      expect(vibration.count).toBe(1);
    } finally {
      vibration.restore();
      restoreMotion();
    }
  });

  test("skips haptics for reduced motion", () => {
    const vibration = stubVibration();
    const restoreMotion = stubReducedMotion(true);
    try {
      render(<NumpadHarness initial="5" />);
      fireEvent.click(page().getByRole("button", { name: "6" }));
      expect(page().getByLabelText("Native amount").textContent).toBe("56");
      expect(vibration.count).toBe(0);
    } finally {
      vibration.restore();
      restoreMotion();
    }
  });

  test("disabled keys neither change the value nor vibrate", () => {
    const vibration = stubVibration();
    const restoreMotion = stubReducedMotion(false);
    try {
      render(<NumpadHarness disabled />);
      fireEvent.click(page().getByRole("button", { name: "5" }));
      expect(page().getByLabelText("Native amount").textContent).toBe("");
      expect(vibration.count).toBe(0);
    } finally {
      vibration.restore();
      restoreMotion();
    }
  });

  test("stays silent when vibration is unavailable", () => {
    const restoreMotion = stubReducedMotion(false);
    let threw = false;
    try {
      triggerKeyHaptic();
    } catch {
      threw = true;
    } finally {
      restoreMotion();
    }
    expect(threw).toBe(false);
  });
});
