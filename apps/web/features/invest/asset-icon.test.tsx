import "@/features/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { AssetMarkPresentation } from "@/features/asset-mark/presentation";

const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { AssetIcon } = await import("./asset-icon");

afterEach(cleanup);

function mark(
  overrides: Partial<AssetMarkPresentation> = {},
): AssetMarkPresentation {
  return {
    assetKey:
      "eip155:8453/erc20:0xb200000000000000000000d9192b6b456483c2e8",
    name: "Amazon",
    symbol: "AM",
    imageUrl: null,
    pending: false,
    currency: null,
    ...overrides,
  };
}

describe("AssetIcon", () => {
  test("holds the shared 32px CurrencyMark shimmer while icons are pending", () => {
    const view = render(<AssetIcon mark={mark({ pending: true })} />);
    const icon = view.getByRole("img", { name: "Amazon icon" });
    const renderedMark = icon.querySelector("[data-mark='shimmer']");
    expect(renderedMark).toBeTruthy();
    expect(renderedMark?.getAttribute("data-shimmer")).toBe("mark");
    expect(renderedMark?.classList.contains("shimmer")).toBe(true);
    expect(icon.querySelector("img")).toBeNull();
    expect(icon.textContent).toBe("");
  });

  test("shimmers an unresolved image then reveals it in the same 32px slot", () => {
    const view = render(
      <AssetIcon
        mark={mark({ imageUrl: "https://icons.example.test/amzn.png" })}
      />,
    );
    const icon = view.getByRole("img", { name: "Amazon icon" });
    const image = icon.querySelector("img");
    expect(icon.querySelector("[data-mark='shimmer']")).toBeTruthy();
    expect(image?.getAttribute("src")).toBe("https://icons.example.test/amzn.png");
    expect(image?.hasAttribute("hidden")).toBe(true);
    expect(icon.textContent).toBe("");

    fireEvent.load(image!);
    expect(icon.querySelector("[data-mark='image']")).toBeTruthy();
    expect(image?.hasAttribute("hidden")).toBe(false);
    expect(icon.textContent).toBe("");
  });

  test("uses the canonical fallback on the shared disc when no image resolves", () => {
    const view = render(<AssetIcon mark={mark()} />);
    const icon = view.getByRole("img", { name: "Amazon icon" });
    expect(icon.querySelector("[data-mark='symbol']")).toBeTruthy();
    expect(icon.textContent).toBe("AM");
    expect(icon.querySelector("img")).toBeNull();
  });

  test("fails a resolved image open to the same canonical fallback", () => {
    const view = render(
      <AssetIcon
        mark={mark({ imageUrl: "https://icons.example.test/missing.png" })}
      />,
    );
    const icon = view.getByRole("img", { name: "Amazon icon" });
    fireEvent.error(icon.querySelector("img")!);
    expect(icon.querySelector("[data-mark='symbol']")).toBeTruthy();
    expect(icon.textContent).toBe("AM");
  });
});
