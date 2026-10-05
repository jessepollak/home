import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { http, HttpResponse } from "msw";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { InvestExperience } from "@/client/invest/invest-experience";
import { InvestPageContent } from "@/client/home/shell-pages";
import { getHomeQueryClient } from "@/client/query/query-client";
import { pinClock } from "@/tests/helpers/pin-clock";
import { investSearchHandler } from "@/stories/journeys/explorations/invest-search.fixtures";
import detailJourney from "@/stories/journeys/invest-asset-detail.stories";
import { assetDetailMarket, assetDetailTime } from "@/stories/journeys/explorations/invest-asset-detail-fixture";
import { CompositionShell, compositionShellHandlers } from "@/stories/journeys/explorations/composition-shell";
import { investLogoResolution } from "@/stories/review/explorations/library/invest-logos";

function InvestComposition() {
  return <CompositionShell investContent={<InvestExperience cryptoMarket={assetDetailMarket} assetMarkResolution={investLogoResolution} />}>
    <InvestPageContent />
  </CompositionShell>;
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
    library: { render: "frame", order: 3 },
    viewport: { viewports: { phone390: { name: "390 × 844", styles: { width: "390px", height: "844px" } } }, defaultViewport: "phone390" },
    nextjs: { navigation: { pathname: "/invest" } },
    msw: { handlers: [
      ...compositionShellHandlers,
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
  parameters: { nextjs: { navigation: { pathname: "/invest/cbbtc" } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("region", { name: "Bitcoin" })).toBeVisible();
    await expect(await canvas.findByRole("group", { name: /1 week price history/ }, { timeout: 5000 })).toBeVisible();
    await expect(await canvas.findByText("0.01234 cbBTC")).toBeVisible();
    await expect(await canvas.findByText("$2.41T")).toBeVisible();
    await expect(await canvas.findByText("$38.2B")).toBeVisible();
    await expect(canvas.getByRole("heading", { level: 1, name: "Bitcoin" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Back" })).toBeVisible();
  },
};
