import { useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { http, HttpResponse } from "msw";
import { AccountWalletClientProvider, createBlockedAccountWalletClient } from "@/client/account/cdp-client";
import { AssetDetailScreen } from "@/client/invest/asset-detail-screen";
import { DiscoverAssetRow } from "@/client/invest/discover-asset-row";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { getHomeQueryClient } from "@/client/query/query-client";
import { BalanceRow } from "@/components/finance-rows";
import { investAssets } from "@/config/invest-assets";
import { balancesSnapshot } from "@/tests/browser/fixtures/balances";
import type { MarketDataState } from "@/shared/invest/invest-market";

const asset = investAssets.find((item) => item.id === "cbbtc")!;
const market: MarketDataState = { status: "ready", snapshots: [{ assetId: asset.id,
  displayPrice: "$122391.18", asOf: new Date().toISOString(), sourceLabel: "Codex", changeLabel: "+4.1%",
}] };
const session = { user: { subject: "synthetic-invest-journey" },
  smartAccount: { address: "0x1111111111111111111111111111111111111111" as const, chainId: 8453 as const },
  accountProvider: "cdp-embedded" as const,
};
function Journey({ entry }: { entry: "discover" | "holding" }) {
  const [selected, setSelected] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const discoverList = useRef<HTMLUListElement | null>(null);
  const open = (element: HTMLElement) => { opener.current = element; setSelected(true); };
  const back = () => {
    setSelected(false);
    queueMicrotask(() => { if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }); });
  };
  const blocked = createBlockedAccountWalletClient("unconfigured");
  const client = { ...blocked, status: "verified" as const, verification: "server" as const, session,
    fetchBalances: async () => {
      const snapshot = balancesSnapshot("US");
      return { ...snapshot, holdings: snapshot.holdings.map((holding) => holding.id === asset.id
        ? { ...holding, balance: { status: "ready" as const, baseUnits: "1234000" },
          value: { status: "priced" as const, currency: "USD" as const,
            amount: { atoms: "151030", scale: 2 }, asOf: new Date().toISOString() } }
        : holding) };
    },
  };
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
  beforeEach: () => { getHomeQueryClient().clear(); return () => getHomeQueryClient().clear(); },
  parameters: { layout: "fullscreen", a11y: { test: "error" }, viewport: { defaultViewport: "mobile" },
    design: { type: "figma", url: "https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=422-4404" },
    msw: { handlers: [
      http.get("/api/market-prices/history", ({ request }) => {
        const url = new URL(request.url);
        const range = url.searchParams.get("range") ?? "1W";
        const durations: Record<string, number> = { "1D": 86400000, "1W": 604800000, "1M": 2592000000,
          "3M": 7776000000, "1Y": 31536000000 };
        const duration = durations[range] ?? durations["1W"]!;
        const end = Date.now() - 60000;
        return HttpResponse.json({ version: 1, provider: "codex", assetId: asset.id, range,
          currency: "USD", fetchedAt: new Date(end).toISOString(), status: "ready",
          points: Array.from({ length: 32 }, (_, index) => ({
            time: new Date(end - duration * (1 - index / 31)).toISOString(),
            value: (117000 + 5391.18 * index / 31).toFixed(2),
          })) });
      }),
      http.get("/api/market-prices/stats", () => HttpResponse.json({ version: 1, provider: "codex",
        assetId: asset.id, currency: "USD", fetchedAt: new Date().toISOString(), status: "ready",
        stats: { marketCapUsd: { atoms: "2410000000000", scale: 0 },
          volume24hUsd: { atoms: "38200000000", scale: 0 } },
      })),
    ] },
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
  await waitFor(() => expect(opener).toHaveFocus());
  await expect(canvas.queryByRole("group", { name: /price history/ })).not.toBeInTheDocument();
}
export const DiscoverToDetail: Story = { play: async ({ canvasElement }) => openAndReturn(canvasElement, /Bitcoin/i) };
export const HoldingToDetail: Story = { args: { entry: "holding" },
  play: async ({ canvasElement }) => openAndReturn(canvasElement, /Bitcoin holding/i) };
