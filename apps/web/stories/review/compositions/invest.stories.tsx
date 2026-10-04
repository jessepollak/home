import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { http, HttpResponse } from "msw";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { useState } from "react";
import { AccountWalletClientProvider } from "@/client/account/cdp-client";
import { InvestExperience } from "@/client/invest/invest-experience";
import { AssetDetailScreen } from "@/client/invest/asset-detail-screen";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { getHomeQueryClient } from "@/client/query/query-client";
import { shellContentFrameClassName } from "@/components/shell-layout";
import { pinClock } from "@/tests/helpers/pin-clock";
import searchJourney from "@/stories/journeys/invest-search.stories";
import detailJourney from "@/stories/journeys/invest-asset-detail.stories";
import { assetDetailAsset, assetDetailMarket, assetDetailTime, createAssetDetailClient } from "@/stories/journeys/explorations/invest-asset-detail-fixture";
import { investLogoHandlers, investLogoResolution } from "@/stories/review/explorations/library/invest-logos";

function InvestComposition() {
  const [client] = useState(createAssetDetailClient);
  return <AccountWalletClientProvider client={client}><PresentationRegionProvider regionId="US">
    <main className={`${shellContentFrameClassName} py-4`}>
      <InvestExperience cryptoMarket={assetDetailMarket} initialView={{ screen: "hub" }} assetMarkResolution={investLogoResolution} />
    </main>
  </PresentationRegionProvider></AccountWalletClientProvider>;
}

function AssetDetailComposition() {
  const [client] = useState(createAssetDetailClient);
  const [detail, setDetail] = useState(true);
  return <AccountWalletClientProvider client={client}><PresentationRegionProvider regionId="US">
    <main className={`${shellContentFrameClassName} py-4`}>
      {detail ? <AssetDetailScreen asset={assetDetailAsset} market={assetDetailMarket} assetMarkResolution={investLogoResolution} onBack={() => setDetail(false)} />
        : <InvestExperience cryptoMarket={assetDetailMarket} initialView={{ screen: "hub" }} assetMarkResolution={investLogoResolution} />}
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
      ...investLogoHandlers,
      http.get("/api/trades", () => HttpResponse.json({ version: 2, status: "unavailable", reason: "asset-unsupported" })),
    ] },
  },
} satisfies Meta<typeof InvestComposition>;
export default meta;
type Story = StoryObj<typeof meta>;

async function expectLogo(canvasElement: HTMLElement, name: string) {
  const image = within(canvasElement).getByRole("img", { name: `${name} icon` }).querySelector("img");
  await waitFor(async () => {
    await expect(image).toBeVisible();
    await expect(image?.naturalWidth).toBeGreaterThan(0);
  });
}

export const Invest: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("textbox", { name: "Search assets" })).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Stocks" })).toBeVisible();
    for (const name of ["NVIDIA", "Meta", "Apple", "Alphabet", "Amazon", "Microsoft"]) {
      await expectLogo(canvasElement, name);
    }
  },
};
export const SearchResults: Story = {
  name: "Search Results",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("textbox", { name: "Search assets" }), "Apple");
    await expect((await canvas.findAllByRole("button", { name: /Apple/ }))[0]).toBeVisible();
    await expectLogo(canvasElement, "Apple");
  },
};

export const AssetDetail: Story = {
  name: "Asset Detail",
  render: () => <AssetDetailComposition />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Bitcoin" })).toBeVisible();
    await expect(await canvas.findByRole("group", { name: /1 week price history/ })).toBeVisible();
    await expect(await canvas.findByText("0.01234 cbBTC")).toBeVisible();
    await expect(await canvas.findByText("$2.41T")).toBeVisible();
    await expect(await canvas.findByText("$38.2B")).toBeVisible();
    await expectLogo(canvasElement, "Bitcoin");
  },
};
