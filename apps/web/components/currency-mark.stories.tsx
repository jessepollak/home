import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { MoneyAssetPicker, type MoneyAssetOption } from "@/client/money-modal/amount";
import { presentPortfolioAssetMark } from "@/client/asset-mark/presentation";
import { PORTFOLIO_NATIVE_ASSET_KEY, PORTFOLIO_USDC_ASSET_KEY, assetKeyForErc20 } from "@/config/portfolio-assets";
import { presentationRegions } from "@/config/regions";
import { BASE_BORROW_COLLATERAL_ASSETS } from "@/shared/assets/base";
import { presentationCurrencyFlag } from "./currency-flag";
import { CurrencyMark } from "./currency-mark";

const currencies = [...new Set([
  ...Object.values(presentationRegions).map((region) => region.currency.code),
  "EUR",
].filter((code): code is string => Boolean(code && presentationCurrencyFlag(code))))].sort();

const options: MoneyAssetOption[] = [
  ...["USD", "EUR", "GBP", "CHF"].map((code) => ({
    id: code.toLowerCase(),
    label: code,
    currency: code,
    mark: presentPortfolioAssetMark({ assetKey: code, name: code, symbol: code, currency: code }),
  })),
  { id: "usdc", label: "USDC", description: "US dollar", mark: presentPortfolioAssetMark({ assetKey: PORTFOLIO_USDC_ASSET_KEY, name: "US dollar", symbol: "USDC" }) },
];

function InventoryStory() {
  return (
    <div className="flex max-w-3xl flex-col gap-6 p-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-3" aria-label="Currency flags">
        {currencies.map((code) => (
          <div key={code} className="flex items-center gap-2">
            <CurrencyMark currency={code} presentation="selector" />
            <CurrencyMark currency={code} presentation="default" />
            <span>{code}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4" aria-label="Other mark states">
        <span className="flex items-center gap-1"><CurrencyMark assetKey={PORTFOLIO_USDC_ASSET_KEY} symbol="USDC" presentation="selector" /> USDC</span>
        <span className="flex items-center gap-1"><CurrencyMark assetKey={PORTFOLIO_NATIVE_ASSET_KEY} symbol="ETH" presentation="selector" /> ETH</span>
        <span className="flex items-center gap-1"><CurrencyMark assetKey={assetKeyForErc20(BASE_BORROW_COLLATERAL_ASSETS[0].address)} symbol="cbBTC" presentation="selector" /> cbBTC</span>
        <span className="flex items-center gap-1"><CurrencyMark src={typeof window === "undefined" ? "/asset-marks/usdc.svg" : new URL("/asset-marks/usdc.svg", window.location.origin).href} symbol="Remote" presentation="selector" /> Image URL</span>
        <span className="flex items-center gap-1"><CurrencyMark pending symbol="Pending" presentation="selector" /> Pending</span>
        <span className="flex items-center gap-1"><CurrencyMark src="/asset-marks/nonexistent-selector-proof.svg" symbol="XYZ" presentation="selector" /> Failed image</span>
        <span className="flex items-center gap-1"><CurrencyMark currency="JPY" symbol="¥" presentation="selector" /> JPY fallback</span>
      </div>
    </div>
  );
}

function HeaderStory() {
  const [selectedId, setSelectedId] = useState("usd");
  const selected = options.find((option) => option.id === selectedId)!;
  return (
    <div className="flex w-[20rem] max-w-full flex-col gap-6 p-4">
      <div className="flex items-center gap-2"><span>Locked</span><MoneyAssetPicker assetId="usd" assetLabel="USD" assetCurrency="USD" locked /></div>
      <div className="flex items-center gap-2"><span>Selectable</span><MoneyAssetPicker assetId={selected.id} assetLabel={selected.label} assetCurrency={selected.currency} assetMark={selected.mark} assetOptions={options} onAssetChange={setSelectedId} /></div>
      <div className="flex items-center gap-2"><span>Long label</span><MoneyAssetPicker assetId="usd" assetLabel="United States dollar long label" assetCurrency="USD" locked /></div>
    </div>
  );
}

async function assertSelectorFlags(root: HTMLElement, expected: number) {
  await waitFor(async () => {
    const flags = root.querySelectorAll<HTMLElement>('[data-presentation="selector"][data-mark="flag"]');
    await expect(flags.length).toBe(expected);
    for (const flag of flags) {
      const image = flag.querySelector("img");
      const inner = flag.querySelector<HTMLElement>("[data-mark-inner]");
      await expect(image?.naturalWidth).toBeGreaterThan(0);
      await expect(inner).not.toBeNull();
      const markBox = flag.getBoundingClientRect();
      const innerBox = inner!.getBoundingClientRect();
      await expect(Math.abs(markBox.width - markBox.height)).toBeLessThanOrEqual(0.5);
      await expect(markBox.width).toBeGreaterThanOrEqual(16);
      await expect(Math.abs(innerBox.width - innerBox.height)).toBeLessThanOrEqual(0.5);
      await expect(innerBox.width).toBeGreaterThanOrEqual(16);
      const imageBox = image!.getBoundingClientRect();
      await expect(imageBox.height * 26 / 36).toBeGreaterThanOrEqual(innerBox.height - 0.5);
      await expect(Math.abs(imageBox.width - imageBox.height)).toBeLessThanOrEqual(0.5);
      await expect(Math.abs((imageBox.top + imageBox.bottom) / 2 - (innerBox.top + innerBox.bottom) / 2)).toBeLessThanOrEqual(0.5);
      await expect(Math.abs((imageBox.left + imageBox.right) / 2 - (innerBox.left + innerBox.right) / 2)).toBeLessThanOrEqual(0.5);
    }
  });
}

const meta = {
  id: "ui-currency-mark",
  title: "UI/Currency Mark",
  component: CurrencyMark,
  parameters: { layout: "centered" },
} satisfies Meta<typeof CurrencyMark>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Inventory: Story = {
  render: () => <InventoryStory />,
  parameters: { a11y: { test: "error" } },
  play: async ({ canvasElement }) => {
    await assertSelectorFlags(within(canvasElement).getByLabelText("Currency flags"), currencies.length);
    await expect(within(canvasElement).getByLabelText("Other mark states")).toHaveTextContent("Failed image");
  },
};

export const Header: Story = {
  render: () => <HeaderStory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("group", { name: "USD" })).toBeVisible();
    await expect(canvas.getByRole("group", { name: "United States dollar long label" })).toBeVisible();
    await assertSelectorFlags(canvasElement, 3);
    await userEvent.click(canvas.getByRole("combobox", { name: "Asset" }));
    const list = await screen.findByRole("listbox");
    await waitFor(async () => {
      for (const code of ["USD", "EUR", "GBP", "CHF"]) {
        await expect(within(list).getByRole("option", { name: code })).toBeVisible();
      }
      await expect(within(list).getByRole("option", { name: /US dollar.*USDC|USDC.*US dollar/ })).toBeVisible();
    });
    await assertSelectorFlags(canvasElement.ownerDocument.body, 7);
  },
};
