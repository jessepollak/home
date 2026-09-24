import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Plus } from "lucide-react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { ActivityPanelView } from "@/client/activity";
import type { UseActivityResult } from "@/client/activity/use-activity";
import { Button } from "@/components/ui/button";
import { shellContentFrameClassName } from "@/components/shell-layout";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { ActivityPage, ActivityTransfer } from "@/shared/activity/types";
import { computeActivityValuationAmount } from "@/shared/activity/valuation";
import {
  borrowPosition,
  buildBalancesSnapshotFixture,
  priced,
  pricedCash,
  ready,
  unavailableBalance,
} from "@/shared/balances/fixtures";
import { presentBalances } from "@/shared/balances/present";
import type { BalancesSnapshot } from "@/shared/balances/types";
import type { ComponentProps } from "react";
import { HomeOverview, HomeSectionHeading } from "./home-overview";
import { HomeHeaderStatus, homeBalancesStatus } from "./home-status";
import { ShellHeader } from "./shell-chrome";
import type { HomeAssetBalancesPresentation } from "./home-types";

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const noop = () => undefined;

function transfer(
  id: string,
  day: number,
  direction: ActivityTransfer["direction"],
  amountBaseUnits: string,
): ActivityTransfer {
  return {
    id: `8453:${USDC}:${id}`,
    logId: id,
    chainId: 8453,
    assetId: "usdc",
    tokenAddress: USDC,
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    walletAddress: WALLET,
    fromAddress: direction === "incoming" ? OTHER : WALLET,
    toAddress: direction === "incoming" ? WALLET : OTHER,
    direction,
    amountBaseUnits,
    blockNumber: String(day),
    blockHash: `0x${"c".repeat(64)}`,
    transactionHash: `0x${day.toString(16).padStart(64, "0")}`,
    logIndex: "1",
    blockTimestamp: `2026-09-${String(day).padStart(2, "0")}T12:00:00.000Z`,
    valuation: {
      status: "priced",
      currency: "USD",
      amount: computeActivityValuationAmount({
        amountBaseUnits,
        tokenDecimals: 6,
        unitPrice: null,
        fxRate: null,
      }),
      method: "peg",
      peg: "USD",
      close: null,
      fx: null,
    },
  };
}

function borrowOperation(): RecentMoneyActionOperation {
  const updatedAt = "2026-09-16T12:00:00.000Z";
  return {
    action: {
      id: "borrow-proceeds",
      kind: "borrow",
      title: "Borrowed",
      amounts: [{
        direction: "receive",
        assetId: "usdc",
        symbol: "USDC",
        decimals: 6,
        amountBaseUnits: "50000000",
      }],
      warnings: [],
      expiresAt: updatedAt,
      createdAt: updatedAt,
    },
    status: "confirmed",
    createdAt: updatedAt,
    updatedAt,
  };
}

function activityPage(transfers: ActivityTransfer[], nextCursor: string | null): ActivityPage {
  return {
    walletAddress: WALLET,
    chainId: 8453,
    currency: "USD",
    window: { from: "2026-08-23T12:00:00.000Z", to: "2026-09-23T12:00:00.000Z" },
    transfers,
    nextCursor,
    source: {
      provider: "cdp-sql",
      cached: false,
      stale: false,
      executionTimestamp: "2026-09-23T12:00:00.000Z",
      executionTimeMs: 1,
      fetchedAt: "2026-09-23T12:00:00.000Z",
    },
  };
}

const handlers = {
  retry: noop,
  refresh: noop,
  setSentinelVisible: noop,
  retryLoadMore: noop,
};

const readyActivity: UseActivityResult = {
  status: "ready",
  page: activityPage([
    transfer("received", 22, "incoming", "25000000"),
    transfer("sent", 21, "outgoing", "12000000"),
    transfer("received-older", 14, "incoming", "60000000"),
  ], "cursor-2"),
  loadingMore: true,
  loadMoreError: false,
  continuing: true,
  ...handlers,
};

const emptyActivity: UseActivityResult = {
  status: "ready",
  page: activityPage([], null),
  loadingMore: false,
  loadMoreError: false,
  continuing: false,
  ...handlers,
};

const loadingActivity: UseActivityResult = {
  status: "loading",
  page: null,
  loadingMore: false,
  loadMoreError: false,
  continuing: false,
  ...handlers,
};

const retryFailedActivity = fn();

const failedActivity: UseActivityResult = {
  status: "error",
  page: null,
  loadingMore: false,
  loadMoreError: false,
  continuing: false,
  error: { code: "ACTIVITY_UPSTREAM", message: "Recent Base activity could not be loaded." },
  ...handlers,
  retry: retryFailedActivity,
};

const cash = {
  usdc: {
    balance: ready("12340000"),
    value: priced("USD", "1234"),
    cashValue: pricedCash("USD", "1234"),
  },
};

const fundedPosition = borrowPosition({
  collateralBaseUnits: "100000",
  collateralValue: priced("USD", "7821"),
  debtBaseUnits: "30010000",
  debtValue: priced("USD", "3001"),
});

function presentation(snapshot: BalancesSnapshot): HomeAssetBalancesPresentation {
  return presentBalances({ status: "ready", snapshot, error: null });
}

const fundedBalances = presentation(buildBalancesSnapshotFixture({
  registry: cash,
  borrow: { coverage: "complete", positions: [fundedPosition] },
}));

const noBorrowBalances = presentation(buildBalancesSnapshotFixture({
  registry: {
    ...cash,
    eth: { balance: ready("25000000000000000"), value: priced("USD", "7821") },
  },
}));

const emptyBalances = presentation(buildBalancesSnapshotFixture());

const partialBalances = presentation(buildBalancesSnapshotFixture({
  registry: {
    ...cash,
    eth: { balance: unavailableBalance, value: { status: "unavailable" } },
  },
  borrow: { coverage: "partial", positions: [] },
}));

const partialBorrowBalances = presentation(buildBalancesSnapshotFixture({
  registry: cash,
  borrow: { coverage: "partial", positions: [fundedPosition] },
}));

const noCountryBalances = presentation(buildBalancesSnapshotFixture({
  region: "GLOBAL",
  registry: cash,
}));

const loadingBalances = presentBalances({ status: "loading", snapshot: null, error: null });

const signedInAccount = {
  status: "verified",
  isSignedIn: true,
  ownerKey: null,
  session: null,
} as unknown as ComponentProps<typeof ShellHeader>["account"];

type HomeOverviewStoryProps = {
  assetBalances: HomeAssetBalancesPresentation;
  activity: UseActivityResult;
  operations?: RecentMoneyActionOperation[];
  cashRate: string | null;
  borrowOfferRate: string | null;
  onReload: () => void;
  onOpenAccount: () => void;
};

function HomeOverviewStory({
  assetBalances,
  activity,
  operations = [],
  cashRate,
  borrowOfferRate,
  onReload,
  onOpenAccount,
}: HomeOverviewStoryProps) {
  const status = homeBalancesStatus(assetBalances);
  return (
    <div>
      <ShellHeader
        isAccountSettingsOpen={false}
        nestedChromeTitle={null}
        nestedChromeBackLabel="Back"
        onNestedChromeBack={noop}
        routeMode="dashboard"
        activeNavigation="home"
        isVerified
        account={signedInAccount}
        onHome={noop}
        onDashboard={noop}
        onSignIn={noop}
        onSignOut={noop}
        onOpenSettings={noop}
        onCloseSettings={noop}
        status={status ? (
          <HomeHeaderStatus status={status} onReload={onReload} onOpenAccount={onOpenAccount} />
        ) : null}
      />
      <main className={shellContentFrameClassName}>
        <HomeOverview
          assetBalances={assetBalances}
          cashRate={cashRate}
          borrowOfferRate={borrowOfferRate}
          destinations={{ onOpenCash: noop, onOpenInvestments: noop, onOpenBorrow: noop }}
          actions={
            <>
              <Button size="lg" className="h-11">
                <Plus className="size-4" aria-hidden="true" />
                Add money
              </Button>
              <Button variant="outline" size="lg" className="h-11">Send</Button>
            </>
          }
          activity={
            <ActivityPanelView
              activity={activity}
              operations={operations}
              regionId="US"
              density="feed"
              header={<HomeSectionHeading id="activity-title">Activity</HomeSectionHeading>}
              emptyAction={
                <Button variant="outline" size="lg" className="h-11">
                  <Plus className="size-4" aria-hidden="true" />
                  Add money
                </Button>
              }
            />
          }
        />
      </main>
    </div>
  );
}

const meta = {
  id: "home-overview",
  title: "Home/Overview",
  component: HomeOverviewStory,
  args: {
    assetBalances: fundedBalances,
    activity: readyActivity,
    operations: [borrowOperation()],
    cashRate: "4.20% APY",
    borrowOfferRate: null,
    onReload: fn(),
    onOpenAccount: fn(),
  },
  parameters: {
    layout: "fullscreen",
    viewport: { defaultViewport: "mobile" },
    a11y: { test: "error" },
    design: {
      type: "figma",
      url: "https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=92-922",
    },
  },
} satisfies Meta<typeof HomeOverviewStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Funded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText("Total balance").textContent).toContain("$60.54");
    const legend = [...canvasElement.querySelectorAll("[data-breakdown-item]")]
      .map((item) => item.getAttribute("data-breakdown-item"));
    await expect(legend).toEqual(["borrow", "cash", "investments"]);
    const summary = within(canvas.getByRole("region", { name: "Your money" }));
    await expect(summary.getAllByRole("listitem")).toHaveLength(3);
    const borrow = summary.getByRole("button", { description: "Open Borrow" });
    await expect(borrow.textContent).toContain("$30.01");
    await expect(borrow.textContent).toContain("5.10% APR");
    await expect(borrow.textContent).not.toContain("−");
    await expect(summary.getByRole("button", { description: "Open Invest" }).textContent)
      .toContain("Across 1 asset");
    for (const destination of ["Open Cash", "Open Invest"]) {
      await expect(summary.getByRole("button", { description: destination })
        .querySelector("[data-mark='glyph']")).not.toBeNull();
    }
    await expect(canvasElement.querySelector("[data-home-status]")).toBeNull();
    const activity = canvas.getByRole("region", { name: "Activity" });
    await expect(activity.querySelector("[data-slot='card']")).toBeNull();
    await expect(activity.querySelector("[data-activity-loader]")).not.toBeNull();
    for (const loadingCopy of within(activity).queryAllByText(/Loading/)) {
      await expect(loadingCopy.getBoundingClientRect().width).toBeLessThanOrEqual(1);
    }
    const tones = [...activity.querySelectorAll("[data-value-tone]")]
      .map((value) => value.getAttribute("data-value-tone"));
    await expect(tones).toEqual(["success", "default", "success", "success"]);
  },
};

export const KeyboardOrder: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    canvas.getByRole("button", { name: "Account" }).focus();
    await userEvent.tab();
    await expect(canvas.getByRole("button", { name: /Add money/ })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole("button", { name: "Send" })).toHaveFocus();
    for (const destination of ["Open Cash", "Open Invest", "Open Borrow"]) {
      await userEvent.tab();
      await expect(canvas.getByRole("button", { description: destination })).toHaveFocus();
    }
    await expect(canvas.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent))
      .toEqual(["Your money", "Activity"]);
  },
};

const indexedDepositTransfer = transfer("sent", 21, "outgoing", "12000000");

export const IndexedActionContext: Story = {
  args: {
    activity: {
      ...readyActivity,
      page: activityPage([
        indexedDepositTransfer,
        transfer("received", 22, "incoming", "25000000"),
      ], null),
      loadingMore: false,
      continuing: false,
    },
    operations: [{
      action: {
        id: "morpho-deposit",
        kind: "savings-deposit",
        title: "Deposit USDC into Morpho",
        amounts: [{
          direction: "spend",
          assetId: "usdc",
          symbol: "USDC",
          decimals: 6,
          amountBaseUnits: "12000000",
        }],
        warnings: [],
        expiresAt: "2026-09-21T12:00:00.000Z",
        createdAt: "2026-09-21T12:00:00.000Z",
      },
      status: "pending",
      transactionHash: indexedDepositTransfer.transactionHash,
      createdAt: "2026-09-21T12:00:00.000Z",
      updatedAt: "2026-09-21T12:01:00.000Z",
    }],
  },
  play: async ({ canvasElement }) => {
    const activity = within(within(canvasElement).getByRole("region", { name: "Activity" }));
    const action = activity.getByRole("button", { description: "View Deposit USDC into Morpho transaction details" });
    await expect(action.textContent).toContain("Deposit USDC into Morpho");
    await expect(action.textContent).toContain("Confirmed");
    await expect(activity.queryByRole("button", { description: "View sent USDC transaction details" })).toBeNull();
    await expect(activity.queryByText("Sent")).toBeNull();
    await expect(activity.getByRole("button", { description: "View received USDC transaction details" })).toBeVisible();
  },
};

export const ActivityDetailReturn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    const row = canvas.getAllByRole("button", { description: /transaction details/ })[1]!;
    await userEvent.click(row);
    const dialog = await body.findByRole("dialog");
    await expect(dialog).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(body.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(row).toHaveFocus());
    await expect(canvas.getAllByRole("button", { description: /transaction details/ })).toHaveLength(4);
  },
};

export const NoBorrowPosition: Story = {
  args: {
    assetBalances: noBorrowBalances,
    borrowOfferRate: "5.10% APR",
    operations: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const borrow = canvas.getByRole("button", { description: "Open Borrow" });
    await expect(borrow.textContent).toContain("Borrow at 5.10% APR");
    await expect(canvasElement.querySelector("[data-breakdown-item='borrow']")).toBeNull();
    await expect(canvasElement.querySelector("[data-balance-axis]")).toBeNull();
  },
};

export const Empty: Story = {
  args: {
    assetBalances: emptyBalances,
    activity: emptyActivity,
    operations: [],
    cashRate: "Up to 4.20% APY",
    borrowOfferRate: "5.10% APR",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText("Total balance").textContent).toContain("$0.00");
    await expect(canvas.getByRole("button", { description: "Open Cash" }).textContent)
      .toContain("Up to 4.20% APY");
    await expect(canvas.getByRole("button", { description: "Open Invest" }).textContent)
      .toContain("Start investing");
    const prompt = canvasElement.querySelector<HTMLElement>("[data-activity-nux]");
    await expect(prompt?.textContent).toContain("No activity yet");
    const addMoney = within(prompt!).getByRole("button", { name: /Add money/ });
    await expect(addMoney.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await expect(canvasElement.querySelector("[data-home-status]")).toBeNull();
  },
};

export const Loading: Story = {
  args: {
    assetBalances: loadingBalances,
    activity: loadingActivity,
    operations: [],
    cashRate: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText("Updating…").getAttribute("aria-busy")).toBe("true");
    await expect(canvas.getByRole("region", { name: "Your money" }).getAttribute("aria-busy")).toBe("true");
    await expect(canvasElement.querySelectorAll("[data-shimmer='row']").length).toBeGreaterThanOrEqual(6);
    await expect(canvasElement.querySelectorAll("[data-shimmer='row'] [data-shimmer='mark']").length)
      .toBeGreaterThanOrEqual(6);
    await expect(canvasElement.querySelectorAll("[data-slot='item-actions']")).toHaveLength(0);
    await expect(canvasElement.querySelector("[data-home-status]")).toBeNull();
  },
};

export const PartialBalances: Story = {
  args: {
    assetBalances: partialBalances,
    operations: [],
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Some balances are unavailable" }));
    const detail = await waitFor(() => {
      const node = canvasElement.ownerDocument.querySelector<HTMLElement>("[data-home-status-detail]");
      if (!node) throw new Error("status detail not open");
      return node;
    });
    await expect(detail.textContent).toContain("Some balances are unavailable");
    await userEvent.click(within(detail).getByRole("button", { name: "Reload" }));
    await expect(args.onReload).toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(canvasElement.ownerDocument.querySelector("[data-home-status-detail]")).toBeNull());
    await expect(canvasElement.querySelector("[data-total-status='partial']")).not.toBeNull();
    const borrow = canvas.getByRole("button", { description: "Open Borrow" });
    await expect(borrow.textContent).toContain("—");
    await expect(borrow.querySelector("[data-slot='item-actions']")).toBeNull();
    await expect(canvasElement.querySelector("[data-value-tone='error']")).toBeNull();
    await expect(canvas.queryByRole("alert")).toBeNull();
  },
};

export const PartialBorrowPosition: Story = {
  args: {
    assetBalances: partialBorrowBalances,
    operations: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvasElement.querySelector("[data-home-status]")?.getAttribute("aria-label"))
      .toBe("Some balances are unavailable");
    const borrow = canvas.getByRole("button", { description: "Open Borrow" });
    await expect(borrow.textContent).toContain("$30.01");
    await expect(borrow.querySelector("[data-value-tone]")?.getAttribute("data-value-tone")).toBe("muted");
  },
};

export const ActivityError: Story = {
  args: {
    activity: failedActivity,
    operations: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("alert")).toBeNull();
    await expect(canvas.queryByRole("button", { name: "Try again" })).toBeNull();
    await expect(canvasElement.querySelector("[data-home-status]")).toBeNull();
    const activity = within(canvas.getByRole("region", { name: "Activity" }));
    await expect(activity.getByRole("status").textContent).toBe("Activity unavailable");
    retryFailedActivity.mockClear();
    await userEvent.click(activity.getByRole("button", { name: "Reload activity" }));
    await expect(retryFailedActivity).toHaveBeenCalledTimes(1);
  },
};

export const NoCountry: Story = {
  args: {
    assetBalances: noCountryBalances,
    operations: [],
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const message = "Choose a country in Account to set how money is shown";
    await userEvent.click(canvas.getByRole("button", { name: message }));
    const detail = await waitFor(() => {
      const node = canvasElement.ownerDocument.querySelector<HTMLElement>("[data-home-status-detail]");
      if (!node) throw new Error("status detail not open");
      return node;
    });
    await expect(within(detail).queryByRole("button", { name: "Reload" })).toBeNull();
    await userEvent.click(within(detail).getByRole("button", { name: "Open Account" }));
    await expect(args.onOpenAccount).toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(canvasElement.ownerDocument.querySelector("[data-home-status-detail]")).toBeNull());
  },
};
