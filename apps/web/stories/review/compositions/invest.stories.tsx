import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { http, HttpResponse } from "msw";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { useRef, useState } from "react";
import { AccountWalletClientProvider } from "@/client/account/cdp-client";
import { InvestExperience } from "@/client/invest/invest-experience";
import { AssetSearch } from "@/client/invest/asset-search";
import { ShellSearchInert, ShellSearchProvider, ShellSearchSurfaceSlot, useShellSearch } from "@/client/home/shell-search";
import { PrimaryNavigation } from "@/components/primary-navigation";
import type { ShellSearchContentProps } from "@/client/home/home-types";
import { AssetDetailScreen } from "@/client/invest/asset-detail-screen";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { getHomeQueryClient } from "@/client/query/query-client";
import { shellContentFrameClassName, shellNavigationClearanceClassName } from "@/components/shell-layout";
import { pinClock } from "@/tests/helpers/pin-clock";
import { investSearchHandler } from "@/stories/journeys/explorations/invest-search.fixtures";
import detailJourney from "@/stories/journeys/invest-asset-detail.stories";
import { assetDetailAsset, assetDetailMarket, assetDetailTime, createAssetDetailClient } from "@/stories/journeys/explorations/invest-asset-detail-fixture";
import { investLogoResolution } from "@/stories/review/explorations/library/invest-logos";

const renderSearchContent = (props: ShellSearchContentProps) => <AssetSearch {...props} assetMarkResolution={investLogoResolution} />;

function InvestCompositionContent() {
  const { open, openSearch } = useShellSearch();
  return <>
    <ShellSearchInert>
      <PrimaryNavigation layout="rail" activeNavigation="invest" onNavigate={() => {}} onOpenSearch={openSearch} />
      <main id="navigation-panel" className={`${shellContentFrameClassName} py-4 ${shellNavigationClearanceClassName}`}>
        <InvestExperience cryptoMarket={assetDetailMarket} initialView={{ screen: "hub" }} assetMarkResolution={investLogoResolution} />
      </main>
    </ShellSearchInert>
    <PrimaryNavigation activeNavigation="invest" onNavigate={() => {}} onOpenSearch={openSearch} searchOpen={open} />
    <ShellSearchSurfaceSlot />
  </>;
}

function InvestComposition() {
  const [client] = useState(createAssetDetailClient);
  const shellRef = useRef<HTMLDivElement>(null);
  const detailTargetRef = useRef(null);
  return <AccountWalletClientProvider client={client}><PresentationRegionProvider regionId="US">
    <div ref={shellRef} className="min-h-dvh bg-muted">
      <ShellSearchProvider content={renderSearchContent} available={true} signedOut={false} ownerKey={client.ownerKey}
        shellRef={shellRef} detailTargetRef={detailTargetRef} onLeaveSearch={() => {}}>
        <InvestCompositionContent />
      </ShellSearchProvider>
    </div>
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
  id: "compositions-invest",
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
    viewport: { viewports: { phone390: { name: "390 × 844", styles: { width: "390px", height: "844px" } } }, defaultViewport: "phone390" },
    nextjs: { navigation: { pathname: "/invest" } },
    msw: { handlers: [
      investSearchHandler,
      ...detailJourney.parameters.msw.handlers,
      http.get("/api/trades", () => HttpResponse.json({ version: 2, status: "unavailable", reason: "asset-unsupported" })),
    ] },
  },
} satisfies Meta<typeof InvestComposition>;
export default meta;
type Story = StoryObj<typeof meta>;

async function expectLogo(canvasElement: HTMLElement, name: string) {
  await expect(within(canvasElement).getByRole("img", { name: `${name} icon` })).toBeVisible();
}

export const Invest: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const opener = canvas.getByRole("button", { name: "Search assets" });
    await expect(opener).toBeVisible();
    await expect(canvas.queryByRole("textbox", { name: "Search assets" })).not.toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "Stocks" })).toBeVisible();
    for (const name of ["NVIDIA", "Meta", "Apple", "Alphabet", "Amazon", "Microsoft"]) {
      await expectLogo(canvasElement, name);
    }
    const screen = within(canvasElement.ownerDocument.body);
    await userEvent.click(opener);
    const input = screen.getByRole("textbox", { name: "Search assets" });
    await expect(input).toHaveFocus();
    await userEvent.type(input, "BTC");
    await expect(await screen.findByRole("button", { name: /Bitcoin/ })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Close search" }));
    await waitFor(() => expect(opener).toHaveFocus());
    await expect(canvas.getByRole("heading", { name: "Stocks" })).toBeVisible();
  },
};
export const AssetDetail: Story = {
  name: "Asset Detail",
  render: () => <AssetDetailComposition />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Bitcoin" })).toBeVisible();
    await expect(await canvas.findByRole("group", { name: /1 week price history/ }, { timeout: 5000 })).toBeVisible();
    await expect(await canvas.findByText("0.01234 cbBTC")).toBeVisible();
    await expect(await canvas.findByText("$2.41T")).toBeVisible();
    await expect(await canvas.findByText("$38.2B")).toBeVisible();
    await expectLogo(canvasElement, "Bitcoin");
  },
};
