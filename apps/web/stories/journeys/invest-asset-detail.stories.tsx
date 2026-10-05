import { useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { waitForReady } from "@/tests/helpers/story-readiness";
import { investMarketHandlers } from "./explorations/invest-market.fixtures";
import { AccountWalletClientProvider } from "@/client/account/cdp-client";
import { AssetDetailScreen } from "@/client/invest/asset-detail-screen";
import { DiscoverAssetRow } from "@/client/invest/discover-asset-row";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { getHomeQueryClient } from "@/client/query/query-client";
import { BalanceRow } from "@/components/finance-rows";
import { assetDetailAsset as asset, assetDetailMarket as market, assetDetailTime as TIME, createAssetDetailClient } from "./explorations/invest-asset-detail-fixture";
import { pinClock } from "@/tests/helpers/pin-clock";


function Journey({ entry }: { entry: "discover" | "holding" }) {
  const [selected, setSelected] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const discoverList = useRef<HTMLUListElement | null>(null);
  const open = (element: HTMLElement) => { opener.current = element; setSelected(true); };
  const back = () => {
    setSelected(false);
    queueMicrotask(() => { if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }); });
  };
  const client = createAssetDetailClient();
  return <AccountWalletClientProvider client={client}><PresentationRegionProvider regionId="US">
    <main className="min-h-screen bg-background">
      <section className="mx-auto max-w-2xl space-y-4 p-4" hidden={selected} aria-label={entry === "holding" ? "Investments" : "Discover"}>
        <h1 className="text-xl font-semibold">{entry === "holding" ? "Investments" : "Discover"}</h1>
        <ul ref={discoverList}>{entry === "discover"
          ? <DiscoverAssetRow asset={asset} market={market} onOpen={() => {
            const element = discoverList.current?.querySelector("button");
            if (element) open(element);
          }} />
          : <BalanceRow icon="↗" label="Bitcoin holding" context="0.01234 cbBTC"
            value="$1,510.30" onActivate={open} activateLabel="View Bitcoin holding" />}</ul>
      </section>
      {selected ? <AssetDetailScreen asset={asset} market={market} onBack={back} /> : null}
    </main>
  </PresentationRegionProvider></AccountWalletClientProvider>;
}
const meta = {
  id: "journeys-invest-asset-detail", title: "Journeys/Invest asset detail", component: Journey,
  args: { entry: "discover" },
  beforeEach: () => { getHomeQueryClient().clear(); const restoreClock = pinClock(TIME); return () => { getHomeQueryClient().clear(); restoreClock(); }; },
  parameters: { layout: "fullscreen", a11y: { test: "error" }, viewport: { defaultViewport: "mobile" },
    msw: { handlers: investMarketHandlers },
  },
} satisfies Meta<typeof Journey>;
export default meta;
type Story = StoryObj<typeof meta>;
async function openAndReturn(canvasElement: HTMLElement, name: RegExp) {
  const canvas = within(canvasElement);
  const opener = canvas.getByRole("button", { name });
  await userEvent.click(opener);
  await expect(await canvas.findByRole("group", { name: /1 week price history/, hidden: false }, { timeout: 5000 })).toBeVisible();
  await expect(await within(canvas.getByRole("region", { name: "Bitcoin" })).findByText("0.01234 cbBTC")).toBeVisible();
  await userEvent.click(canvas.getByRole("button", { name: "Back" }));
  await waitForReady(() => expect(opener).toHaveFocus());
  await expect(canvas.queryByRole("group", { name: /price history/ })).not.toBeInTheDocument();
}
export const DiscoverToDetail: Story = { play: async ({ canvasElement }) => openAndReturn(canvasElement, /Bitcoin/i) };
export const HoldingToDetail: Story = { args: { entry: "holding" },
  play: async ({ canvasElement }) => openAndReturn(canvasElement, /Bitcoin holding/i) };
