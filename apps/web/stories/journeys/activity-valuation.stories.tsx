import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { ConnectedActivityPanel } from "@/client/home/activity-panel";
import { shellContentFrameClassName } from "@/components/shell-layout";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { activityAssets } from "@/shared/activity/types";
import {
  computeActivityValuationAmount,
  type ActivityTransferValuation,
} from "@/shared/activity/valuation";
import type { ExactDecimal } from "@/shared/balances/types";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const COUNTERPARTY = "0x2222222222222222222222222222222222222222" as const;
const TEST_TOKEN = "0x5555555555555555555555555555555555555555" as const;
const DUST_TOKEN = "0x6666666666666666666666666666666666666666" as const;
const THIN_TOKEN = "0x7777777777777777777777777777777777777777" as const;
const UNKNOWN_TOKEN = "0x8888888888888888888888888888888888888888" as const;
const usdc = activityAssets.find((asset) => asset.id === "usdc")!;
const cbbtc = activityAssets.find((asset) => asset.id === "cbbtc")!;

const session: VerifiedAccountSession = {
  user: { subject: "storybook-activity-valuation-owner" },
  smartAccount: { address: ACCOUNT, chainId: 8453 },
  accountProvider: "cdp-embedded",
};

type Fixture = {
  logId: string;
  token: `0x${string}`;
  assetId: string | null;
  symbol: string | null;
  decimals: number | null;
  direction: "incoming" | "outgoing" | "self";
  amountBaseUnits: string;
  minutesAgo: number;
  valuation: (blockTimestamp: string) => ActivityTransferValuation;
};

function historical(
  amountBaseUnits: string,
  decimals: number,
  priceUsd: ExactDecimal,
): (blockTimestamp: string) => ActivityTransferValuation {
  return (blockTimestamp) => ({
    status: "priced",
    currency: "USD",
    amount: computeActivityValuationAmount({
      amountBaseUnits,
      tokenDecimals: decimals,
      unitPrice: priceUsd,
      fxRate: null,
    }),
    method: "historical-close",
    peg: null,
    close: {
      provider: "Codex",
      closedAt: new Date(
        Math.floor((Date.parse(blockTimestamp) - 5 * 60_000) / 900_000) * 900_000,
      ).toISOString(),
      resolutionMinutes: 15,
      priceUsd,
    },
    fx: null,
  });
}

const unpriced = (reason: "no-recent-close" | "unknown-token" | "quote-unavailable") =>
  (): ActivityTransferValuation => ({ status: "unpriced", currency: "USD", reason });

const pricedFixtures: Fixture[] = [
  {
    logId: "received-test",
    token: TEST_TOKEN,
    assetId: null,
    symbol: "TEST",
    decimals: 18,
    direction: "incoming",
    amountBaseUnits: "5678000000000000000000",
    minutesAgo: 12,
    valuation: historical("5678000000000000000000", 18, { atoms: "21733", scale: 7 }),
  },
  {
    logId: "sent-usdc",
    token: usdc.tokenAddress,
    assetId: "usdc",
    symbol: "USDC",
    decimals: 6,
    direction: "outgoing",
    amountBaseUnits: "25000000",
    minutesAgo: 95,
    valuation: () => ({
      status: "priced",
      currency: "USD",
      amount: computeActivityValuationAmount({
        amountBaseUnits: "25000000",
        tokenDecimals: 6,
        unitPrice: null,
        fxRate: null,
      }),
      method: "peg",
      peg: "USD",
      close: null,
      fx: null,
    }),
  },
  {
    logId: "self-cbbtc",
    token: cbbtc.tokenAddress,
    assetId: "cbbtc",
    symbol: "cbBTC",
    decimals: 8,
    direction: "self",
    amountBaseUnits: "150000",
    minutesAgo: 60 * 26,
    valuation: historical("150000", 8, { atoms: "642105", scale: 1 }),
  },
  {
    logId: "received-dust",
    token: DUST_TOKEN,
    assetId: null,
    symbol: "DUST",
    decimals: 18,
    direction: "incoming",
    amountBaseUnits: "3000000000000000000",
    minutesAgo: 60 * 50,
    valuation: historical("3000000000000000000", 18, { atoms: "12", scale: 7 }),
  },
  {
    logId: "received-thin",
    token: THIN_TOKEN,
    assetId: null,
    symbol: "THIN",
    decimals: 18,
    direction: "incoming",
    amountBaseUnits: "420000000000000000000",
    minutesAgo: 60 * 75,
    valuation: unpriced("no-recent-close"),
  },
  {
    logId: "received-unknown",
    token: UNKNOWN_TOKEN,
    assetId: null,
    symbol: null,
    decimals: null,
    direction: "incoming",
    amountBaseUnits: "123456789",
    minutesAgo: 60 * 99,
    valuation: unpriced("unknown-token"),
  },
];

const missingPriceFixtures: Fixture[] = pricedFixtures
  .filter((fixture) => fixture.decimals !== null)
  .map((fixture) => fixture.assetId === "usdc"
    ? fixture
    : { ...fixture, valuation: unpriced("quote-unavailable") });

function activityResponse(query: string, fixtures: readonly Fixture[]): unknown {
  const parameters = new URLSearchParams(query);
  const to = parameters.get("to")!;
  const toMs = Date.parse(to);
  return {
    version: 1,
    walletAddress: ACCOUNT,
    chainId: 8453,
    window: { from: new Date(toMs - 31 * 24 * 60 * 60 * 1_000).toISOString(), to },
    currency: parameters.get("currency"),
    transfers: fixtures.map((fixture, index) => {
      const blockTimestamp = new Date(toMs - fixture.minutesAgo * 60_000).toISOString();
      const blockNumber = String(51_000_000 - index * 100);
      return {
        id: `8453:${fixture.token.toLowerCase()}:${fixture.logId}`,
        logId: fixture.logId,
        chainId: 8453,
        assetId: fixture.assetId,
        tokenAddress: fixture.token.toLowerCase(),
        tokenSymbol: fixture.symbol,
        tokenDecimals: fixture.decimals,
        walletAddress: ACCOUNT,
        fromAddress: fixture.direction === "incoming" ? COUNTERPARTY : ACCOUNT,
        toAddress: fixture.direction === "outgoing" ? COUNTERPARTY : ACCOUNT,
        direction: fixture.direction,
        amountBaseUnits: fixture.amountBaseUnits,
        blockNumber,
        blockHash: `0x${blockNumber.padStart(64, "0")}`,
        transactionHash: `0x${String(index + 1).padStart(64, "a")}`,
        logIndex: "1",
        blockTimestamp,
        valuation: fixture.valuation(blockTimestamp),
      };
    }),
    nextCursor: null,
    source: {
      provider: "cdp-sql",
      cached: false,
      stale: false,
      executionTimestamp: to,
      executionTimeMs: 1,
      fetchedAt: to,
    },
  };
}

function ActivityValuationSurface({
  state,
}: {
  state: "priced" | "missing-price" | "loading";
}) {
  const fetchActivity = (query: string) => {
    if (state === "loading") return new Promise<unknown>(() => undefined);
    return Promise.resolve(
      activityResponse(query, state === "priced" ? pricedFixtures : missingPriceFixtures),
    );
  };
  return (
    <main className={shellContentFrameClassName}>
      <ConnectedActivityPanel
        activitySession={session}
        fetchActivity={fetchActivity}
        fetchOperations={() => Promise.resolve({ actions: [] })}
        regionId="US"
        density="page"
      />
    </main>
  );
}

const meta = {
  id: "journeys-activity-valuation",
  title: "Journeys/Activity Valuation",
  component: ActivityValuationSurface,
  args: { state: "priced" },
  parameters: {
    layout: "fullscreen",
    viewport: { defaultViewport: "mobile" },
  },
} satisfies Meta<typeof ActivityValuationSurface>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Priced: Story = {
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const receivedRow = await screen.findByRole("button", {
      description: /View received TEST transaction details/,
    });
    await expect(within(receivedRow).getByRole("img", { name: "+$12.34" })).toBeVisible();
    await expect(within(receivedRow).getByText("+5,678 TEST")).toBeVisible();

    const sentRow = screen.getByRole("button", { description: /View sent USDC transaction details/ });
    await expect(within(sentRow).getByRole("img", { name: "−$25.00" })).toBeVisible();
    await expect(within(sentRow).getByText("−25.00 USDC")).toBeVisible();

    const selfRow = screen.getByRole("button", { description: /View self transfer cbBTC transaction details/ });
    await expect(within(selfRow).getByRole("img", { name: "$96.32" })).toBeVisible();
    await expect(within(selfRow).getByText("0.0015 cbBTC")).toBeVisible();

    const dustRow = screen.getByRole("button", { description: /View received DUST transaction details/ });
    await expect(within(dustRow).getByRole("img", { name: "+<$0.01" })).toBeVisible();

    const thinRow = screen.getByRole("button", { description: /View received THIN transaction details/ });
    await expect(within(thinRow).getByRole("img", { name: "+420 THIN" })).toBeVisible();
    await expect(within(thinRow).queryByText(/\$/)).toBeNull();

    await userEvent.click(receivedRow);
    const dialog = await screen.findByRole("dialog", { name: "Received TEST" });
    await expect(within(dialog).getByText("+$12.34")).toBeVisible();
    await expect(within(dialog).getByText("+5,678 TEST")).toBeVisible();
    await expect(within(dialog).queryByText(/Historical close/)).toBeNull();
    await expect(within(dialog).queryByText("Quote time")).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Close transaction details" }));
  },
};

export const PricedDesktop: Story = {
  parameters: { viewport: { defaultViewport: "desktop" } },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const receivedRow = await screen.findByRole("button", {
      description: /View received TEST transaction details/,
    });
    await expect(within(receivedRow).getByRole("img", { name: "+$12.34" })).toBeVisible();
    await expect(within(receivedRow).getByText("+5,678 TEST")).toBeVisible();
  },
};

export const MissingPrice: Story = {
  args: { state: "missing-price" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const receivedRow = await screen.findByRole("button", {
      description: /View received TEST transaction details/,
    });
    await expect(within(receivedRow).getByRole("img", { name: "+5,678 TEST" })).toBeVisible();
    await expect(within(receivedRow).queryByText(/\$/)).toBeNull();
    await userEvent.click(receivedRow);
    const dialog = await screen.findByRole("dialog", { name: "Received TEST" });
    await expect(within(dialog).getByText("Unknown")).toBeVisible();
    await expect(within(dialog).queryByText(/Not priced/)).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Close transaction details" }));
  },
};

export const Loading: Story = {
  args: { state: "loading" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByText("Loading recent activity…")).toBeInTheDocument();
  },
};
