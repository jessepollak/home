import "@/features/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";

const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { CurrencyMark } = await import("./currency-mark");

afterEach(cleanup);

describe("CurrencyMark", () => {
  test("holds the 32px slot on shimmer while a cash flag or row is pending", () => {
    const pending = render(<CurrencyMark pending />);
    const shimmer = pending.container.querySelector("[data-mark='shimmer']");
    expect(shimmer).toBeTruthy();
    expect(shimmer?.getAttribute("data-shimmer")).toBe("mark");
    expect(shimmer?.classList.contains("shimmer")).toBe(true);
    expect(shimmer?.querySelector("img")).toBeNull();
    expect(shimmer?.textContent).toBe("");
    pending.unmount();

    const loading = render(<CurrencyMark currency="USD" symbol="$" />);
    const mark = loading.container.querySelector("[data-mark='shimmer']");
    const image = loading.container.querySelector("img");
    expect(mark).toBeTruthy();
    expect(image?.getAttribute("src")).toBe("/currency-flags/us.svg");
    expect(image?.hasAttribute("hidden")).toBe(true);
    expect(loading.container.textContent).toBe("");
  });

  test("reveals circle-cropped flags for cash currencies and fails open to the symbol", () => {
    const usd = render(<CurrencyMark currency="USD" symbol="$" />);
    fireEvent.load(usd.container.querySelector("img")!);
    expect(usd.container.querySelector("[data-mark='flag']")).toBeTruthy();
    expect(usd.container.querySelector("img")?.getAttribute("src")).toBe(
      "/currency-flags/us.svg",
    );
    expect(usd.container.querySelector("img")?.hasAttribute("hidden")).toBe(
      false,
    );
    usd.unmount();

    const idr = render(<CurrencyMark currency="IDR" symbol="Rp" />);
    fireEvent.load(idr.container.querySelector("img")!);
    expect(idr.container.querySelector("img")?.getAttribute("src")).toBe(
      "/currency-flags/id.svg",
    );
    idr.unmount();

    const eur = render(<CurrencyMark currency="EUR" symbol="€" />);
    fireEvent.load(eur.container.querySelector("img")!);
    expect(eur.container.querySelector("img")?.getAttribute("src")).toBe(
      "/currency-flags/eu.svg",
    );
    eur.unmount();

    const broken = render(<CurrencyMark currency="BRL" symbol="R$" />);
    fireEvent.error(broken.container.querySelector("img")!);
    expect(broken.container.querySelector("[data-mark='symbol']")).toBeTruthy();
    expect(broken.container.querySelector("img")).toBeNull();
    expect(broken.container.textContent).toBe("R$");
  });

  test("uses the currency symbol on a gray disc — never letter initials or a crypto flag", () => {
    const missing = render(
      <CurrencyMark currency="LCL" symbol="LCL" />,
    );
    expect(missing.container.querySelector("img")).toBeNull();
    expect(missing.container.querySelector("[data-mark='symbol']")).toBeTruthy();
    expect(missing.container.textContent).toBe("LCL");
    expect(missing.container.textContent).not.toBe("Lo");
    missing.unmount();

    const weth = render(<CurrencyMark currency={null} symbol="WETH" />);
    expect(weth.container.querySelector("img")).toBeNull();
    expect(weth.container.querySelector("[data-mark='eth']")).toBeNull();
    expect(weth.container.querySelector("[data-mark='symbol']")).toBeTruthy();
    expect(weth.container.textContent).toBe("WETH");
  });

  test("paints a dedicated ETH diamond — never ET initials or a country flag", () => {
    const eth = render(<CurrencyMark currency={null} symbol="ETH" />);
    const mark = eth.container.querySelector("[data-mark='eth']");
    expect(mark).toBeTruthy();
    expect(mark?.querySelector("svg")).toBeTruthy();
    expect(mark?.querySelector("circle")?.getAttribute("fill")).toBe("#627EEA");
    expect(eth.container.querySelector("img")).toBeNull();
    expect(eth.container.textContent).toBe("");
    expect(eth.container.textContent).not.toBe("ET");
    expect(eth.container.textContent).not.toBe("ETH");
    eth.unmount();

    const ticker = render(<CurrencyMark currency="ETH" symbol="ETH" />);
    expect(ticker.container.querySelector("[data-mark='eth']")).toBeTruthy();
    expect(ticker.container.querySelector("img")).toBeNull();
    expect(ticker.container.textContent).toBe("");

    const pending = render(
      <CurrencyMark currency={null} symbol="ETH" pending />,
    );
    expect(pending.container.querySelector("[data-mark='shimmer']")).toBeTruthy();
    expect(pending.container.querySelector("[data-mark='eth']")).toBeNull();
    expect(pending.container.querySelector("svg")).toBeNull();
    expect(pending.container.textContent).toBe("");
    pending.unmount();

    const imaged = render(
      <CurrencyMark
        currency={null}
        symbol="ETH"
        src="https://icons.example.test/eth.png"
      />,
    );
    expect(imaged.container.querySelector("svg")).toBeNull();
    expect(imaged.container.querySelector("img")?.getAttribute("src")).toBe(
      "https://icons.example.test/eth.png",
    );
    fireEvent.load(imaged.container.querySelector("img")!);
    expect(imaged.container.querySelector("[data-mark='image']")).toBeTruthy();
    expect(imaged.container.querySelector("[data-mark='eth']")).toBeNull();
  });

  test("holds the 32px slot on shimmer while an asset image is pending or loading", () => {
    const pending = render(
      <CurrencyMark
        pending
        src="https://icons.example.test/amzn.png"
        symbol="AM"
      />,
    );
    expect(pending.container.querySelector("[data-mark='shimmer']")).toBeTruthy();
    expect(pending.container.querySelector("img")).toBeNull();
    expect(pending.container.textContent).toBe("");
    pending.unmount();

    const loading = render(
      <CurrencyMark src="https://icons.example.test/amzn.png" symbol="AM" />,
    );
    const image = loading.container.querySelector("img");
    expect(loading.container.querySelector("[data-mark='shimmer']")).toBeTruthy();
    expect(image?.getAttribute("src")).toBe("https://icons.example.test/amzn.png");
    expect(image?.hasAttribute("hidden")).toBe(true);
    expect(loading.container.textContent).toBe("");
    fireEvent.load(image!);
    expect(loading.container.querySelector("[data-mark='image']")).toBeTruthy();
    expect(image?.hasAttribute("hidden")).toBe(false);
    expect(loading.container.textContent).toBe("");
  });

  test("reveals an already-decoded asset image without waiting for a late onLoad", () => {
    const proto = HTMLImageElement.prototype;
    const complete = Object.getOwnPropertyDescriptor(proto, "complete");
    const naturalWidth = Object.getOwnPropertyDescriptor(proto, "naturalWidth");
    Object.defineProperty(proto, "complete", {
      configurable: true,
      get() {
        return true;
      },
    });
    Object.defineProperty(proto, "naturalWidth", {
      configurable: true,
      get() {
        return 32;
      },
    });
    try {
      const view = render(
        <CurrencyMark src="https://icons.example.test/amzn.png" symbol="AM" />,
      );
      const image = view.container.querySelector("img");
      expect(view.container.querySelector("[data-mark='image']")).toBeTruthy();
      expect(image?.hasAttribute("hidden")).toBe(false);
    } finally {
      if (complete) Object.defineProperty(proto, "complete", complete);
      else delete (proto as { complete?: unknown }).complete;
      if (naturalWidth) Object.defineProperty(proto, "naturalWidth", naturalWidth);
      else delete (proto as { naturalWidth?: unknown }).naturalWidth;
    }
  });

  test("fails an asset image open to the glyph without a blank hole", () => {
    const broken = render(
      <CurrencyMark src="https://icons.example.test/missing.png" symbol="AM" />,
    );
    fireEvent.error(broken.container.querySelector("img")!);
    expect(broken.container.querySelector("[data-mark='symbol']")).toBeTruthy();
    expect(broken.container.querySelector("img")).toBeNull();
    expect(broken.container.textContent).toBe("AM");
  });

  test("lets a resolved asset image win over a cash flag", () => {
    const mark = render(
      <CurrencyMark
        currency="USD"
        symbol="$"
        src="https://icons.example.test/amzn.png"
      />,
    );
    expect(mark.container.querySelector("img")?.getAttribute("src")).toBe(
      "https://icons.example.test/amzn.png",
    );
    expect(mark.container.querySelector("img")?.getAttribute("src")).not.toBe(
      "/currency-flags/us.svg",
    );
  });
});
