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

    const eth = render(<CurrencyMark currency={null} symbol="ETH" />);
    expect(eth.container.querySelector("img")).toBeNull();
    expect(eth.container.textContent).toBe("ETH");
    expect(eth.container.textContent).not.toBe("ET");
    eth.unmount();

    const ticker = render(<CurrencyMark currency="ETH" symbol="ETH" />);
    expect(ticker.container.querySelector("img")).toBeNull();
    expect(ticker.container.textContent).toBe("ETH");
  });
});
