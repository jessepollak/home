import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { delay, http, HttpResponse } from "msw";
import { expect, userEvent, within } from "storybook/test";
import { useState } from "react";
import { AccountWalletClientProvider } from "@/client/account/cdp-client";
import { InvestExperience } from "@/client/invest/invest-experience";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { getHomeQueryClient } from "@/client/query/query-client";
import { shellContentFrameClassName } from "@/components/shell-layout";
import { pinClock } from "@/tests/helpers/pin-clock";
import searchJourney from "@/stories/journeys/invest-search.stories";
import detailJourney from "@/stories/journeys/invest-asset-detail.stories";
import { assetDetailMarket, assetDetailTime, createAssetDetailClient } from "@/stories/journeys/explorations/invest-asset-detail-fixture";

function InvestComposition({ detail = false }: { detail?: boolean }) {
  const [client] = useState(createAssetDetailClient);
  return <AccountWalletClientProvider client={client}><PresentationRegionProvider regionId="US">
    <main className={`${shellContentFrameClassName} py-4`}>
      <InvestExperience cryptoMarket={assetDetailMarket} initialView={detail ? { screen: "detail", assetId: "cbbtc", from: "hub" } : { screen: "hub" }} />
    </main>
  </PresentationRegionProvider></AccountWalletClientProvider>;
}

const meta = {
  title: "Compositions/Invest",
  component: InvestComposition,
  beforeEach: () => {
    window.history.replaceState(null, "", window.location.href);
    getHomeQueryClient().clear();
    return pinClock(assetDetailTime);
  },
  parameters: {
    layout: "fullscreen",
    library: { render: "frame", order: 5 },
    viewport: { viewports: { desktop1280: { name: "1280 × 800", styles: { width: "1280px", height: "800px" } } }, defaultViewport: "desktop1280" },
    msw: { handlers: [
      ...searchJourney.parameters.msw.handlers.slice(0, 1),
      ...detailJourney.parameters.msw.handlers,
      http.get("/api/trades", () => HttpResponse.json({ version: 2, status: "unavailable", reason: "asset-unsupported" })),
    ] },
  },
} satisfies Meta<typeof InvestComposition>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Invest: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("textbox", { name: "Search assets" })).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Stocks" })).toBeVisible();
  },
};
export const SearchResults: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("textbox", { name: "Search assets" }), "ORB");
    await expect(await canvas.findAllByRole("button", { name: /Orbit/ })).toHaveLength(3);
  },
};
export const AssetDetail: Story = {
  args: { detail: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("group", { name: /1 week price history/ }, { timeout: 5000 })).toBeVisible();
    await expect(await within(canvas.getByRole("region", { name: "Bitcoin" })).findByText("0.01234 cbBTC")).toBeVisible();
  },
};
export const Loading: Story = {
  parameters: { msw: { handlers: [http.get("/api/invest/search", async () => { await delay("infinite"); })] } },
  play: async ({ canvasElement }) => {
    await userEvent.type(within(canvasElement).getByRole("textbox", { name: "Search assets" }), "ORB");
  },
};
export const Empty: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("textbox", { name: "Search assets" }), "nothing-found");
    await expect(await canvas.findAllByText("No results")).toHaveLength(2);
  },
};
export const Error: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("textbox", { name: "Search assets" }), "unavailable");
    await expect(await canvas.findByRole("button", { name: "Retry" })).toBeVisible();
  },
};
export const Partial: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("textbox", { name: "Search assets" }), "partial");
    await expect(await canvas.findByText("Some results couldn’t load.")).toBeVisible();
  },
};
