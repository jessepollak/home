import "@/features/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";

const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { AssetIcon } = await import("./asset-icon");

afterEach(cleanup);

describe("AssetIcon", () => {
  test("holds the shared 32px CurrencyMark shimmer while icons are pending", () => {
    const view = render(
      <AssetIcon assetId="amznc" label="Amazon" initials="AM" pending />,
    );
    const icon = view.getByRole("img", { name: "Amazon icon" });
    const mark = icon.querySelector("[data-mark='shimmer']");
    expect(mark).toBeTruthy();
    expect(mark?.getAttribute("data-shimmer")).toBe("mark");
    expect(mark?.classList.contains("shimmer")).toBe(true);
    expect(icon.querySelector("img")).toBeNull();
    expect(icon.textContent).toBe("");
  });

  test("shimmers an unresolved image then reveals it in the same 32px slot", () => {
    const view = render(
      <AssetIcon
        assetId="amznc"
        label="Amazon"
        initials="AM"
        imageUrl="https://icons.example.test/amzn.png"
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

  test("uses initials on the shared disc when not pending and no image", () => {
    const view = render(
      <AssetIcon assetId="amznc" label="Amazon" initials="AM" />,
    );
    const icon = view.getByRole("img", { name: "Amazon icon" });
    expect(icon.querySelector("[data-mark='symbol']")).toBeTruthy();
    expect(icon.textContent).toBe("AM");
    expect(icon.querySelector("img")).toBeNull();
  });
});
