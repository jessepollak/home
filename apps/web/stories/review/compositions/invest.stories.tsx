import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { http, HttpResponse } from "msw";
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

function InvestComposition() {
  const [client] = useState(createAssetDetailClient);
  return <AccountWalletClientProvider client={client}><PresentationRegionProvider regionId="US">
    <main className={`${shellContentFrameClassName} py-4`}>
      <InvestExperience cryptoMarket={assetDetailMarket} initialView={{ screen: "hub" }} />
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
    a11y: { test: "error" },
    library: { render: "frame", order: 2 },
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
export const SearchToOrbitDetail: Story = {
  name: "Orbit Detail",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("textbox", { name: "Search assets" }), "ORB");
    const [orbit] = await canvas.findAllByRole("button", { name: /Orbit/ });
    if (!orbit) throw new globalThis.Error("Missing Orbit search result");
    await userEvent.click(orbit);
    await expect(await canvas.findByRole("heading", { name: "Orbit" })).toBeVisible();
    await expect(await canvas.findByRole("status", { name: "No price history for this range." })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Back" }));
    await expect(canvas.getByRole("textbox", { name: "Search assets" })).toHaveValue("ORB");
    await userEvent.click((await canvas.findAllByRole("button", { name: /Orbit/ }))[0] ?? orbit);
    await expect(await canvas.findByRole("heading", { name: "Orbit" })).toBeVisible();
  },
};
