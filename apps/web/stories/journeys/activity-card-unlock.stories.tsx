import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useMemo, useRef } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { waitForReady } from "@/tests/helpers/story-readiness";
import { AccountWalletContext, type AccountWalletClient } from "@/client/account/cdp-client";
import type { FetchActivity } from "@/client/activity";
import { ConnectedActivityPanel } from "@/client/home/activity-panel";
import { HomeShellRoutingProvider, readHomeInboundPanelState, type HomeShellRouting } from "@/client/home/panel-routing";
import { ShellPageProvider } from "@/client/home/shell-page-context";
import { getHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { CARDS_CONTRACT_VERSION, type CardsResponse } from "@/shared/cards/contract";
import { CARD_PURCHASES_VERSION, type CardPurchase } from "@/shared/cards/transactions-contract";

const FETCHED_AT = "2026-09-24T12:00:00.000Z";
const noop = () => undefined;
const openPanel = fn();
const frozenSession: VerifiedAccountSession = {
  user: { subject: "activity-unlock-frozen" },
  smartAccount: { address: "0x3333333333333333333333333333333333333333", chainId: 8453 },
  accountProvider: "cdp-embedded",
};
const activeSession: VerifiedAccountSession = {
  user: { subject: "activity-unlock-active" },
  smartAccount: { address: "0x4444444444444444444444444444444444444444", chainId: 8453 },
  accountProvider: "cdp-embedded",
};

function cardsFixture(state: "frozen" | "active"): CardsResponse {
  return {
    version: CARDS_CONTRACT_VERSION, state,
    cards: [{ id: "11111111-1111-4111-8111-111111111107", status: state, last4: "1107" }],
    provenance: { program: "bridge", account: "available", cards: "available", fetchedAt: FETCHED_AT },
  };
}
const frozenCards = cardsFixture("frozen");
const activeCards = cardsFixture("active");
const fetchOperations = async () => ({ version: 1, actions: [], truncated: false });
const routing: HomeShellRouting = {
  state: readHomeInboundPanelState(
    { panel: "activity", account: null, shelf: null, asset: null, market: null, cashView: "savings" },
    new URLSearchParams(),
  ),
  popRevision: 0, rootRequest: null,
  openPanel, pushRoute: noop, leaveRoute: noop,
  canOpenAssetDetail: () => false, openAssetDetail: () => false,
  setFlow: () => false, clearFlow: noop,
};

function ActivityCardUnlock({ session, cards, ownerKey, failRefetch = false }: {
  session: VerifiedAccountSession;
  cards: CardsResponse;
  ownerKey: string;
  failRefetch?: boolean;
}) {
  const cardReads = useRef(0);
  const wallet = useMemo(() => ({
    ownerKey,
    fetchAccountResource: async (path: string) => {
      if (path === "/api/cards") {
        cardReads.current += 1;
        if (failRefetch && cardReads.current > 1) throw new Error("Card refresh failed.");
        return cards;
      }
      if (path === "/api/activity/orders") return {
        version: 1, owner: { subject: session.user.subject, accountProvider: session.accountProvider }, orders: [],
      };
      throw new Error(`Unexpected account resource: ${path}`);
    },
  }) as unknown as AccountWalletClient, [session, cards, ownerKey, failRefetch]);
  const fetchActivity = useMemo<FetchActivity>(() => async (query) => {
    const params = new URLSearchParams(query);
    const to = params.get("to");
    if (!to || !session.smartAccount) throw new Error("Activity fixture requires a window and wallet.");
    const timestamp = new Date(Date.parse(to) - 60_000).toISOString();
    const purchase: CardPurchase = {
      id: "11111111-1111-4111-8111-111111110022", kind: "authorization", amountMinor: "1820", currency: "USD",
      merchantName: "Fixture Market", merchantCategory: null, status: "declined", declineReasonCode: "card_inactive",
      createdAt: timestamp, updatedAt: timestamp,
    };
    return {
      version: 1, walletAddress: session.smartAccount.address, chainId: 8453,
      currency: params.get("currency") ?? "USD",
      window: { from: new Date(Date.parse(to) - 31 * 24 * 60 * 60_000).toISOString(), to },
      transfers: [], cards: { version: CARD_PURCHASES_VERSION, status: "ready", rows: [purchase] }, nextCursor: null,
      source: { provider: "cdp-sql", cached: false, stale: false, executionTimestamp: to, executionTimeMs: 1, fetchedAt: to },
    };
  }, [session]);
  return (
    <HomeShellRoutingProvider value={routing}>
      <AccountWalletContext value={wallet}>
        <ShellPageProvider value={{
          paintedAssetBalances: { status: "loading", displayTotal: null, breakdown: [], summary: null },
          activitySession: session, fetchActivity, fetchOperations,
          regionId: "US", regionReady: true, sessionSettling: false, isChecking: false, isVerified: true,
          sendAvailability: [], showSmallBalances: false, cardsEnabled: true,
          onHomeDetailsOpenChange: noop, openInvestmentHolding: noop, closeInvestmentHolding: noop,
          investmentsReturnHolding: null, openCashSavings: noop, onInvestmentsChromeChange: noop,
          initialAddMoney: false, returnedFromProvider: false, initialSendFlow: false, initialSendActionId: null,
        }}>
          <main className="mx-auto max-w-2xl p-4">
            <h1 className="sr-only">Card purchase activity</h1>
            <ConnectedActivityPanel density="page" activitySession={session} fetchActivity={fetchActivity}
              fetchOperations={fetchOperations} regionId="US" />
          </main>
        </ShellPageProvider>
      </AccountWalletContext>
    </HomeShellRoutingProvider>
  );
}

const meta = {
  id: "journeys-activity-card-unlock", title: "Journeys/Activity card unlock", component: ActivityCardUnlock,
  args: { session: frozenSession, cards: frozenCards, ownerKey: "storybook-activity-card-unlock-frozen" },
  parameters: { viewport: { defaultViewport: "mobile" }, a11y: { test: "error" } },
} satisfies Meta<typeof ActivityCardUnlock>;
export default meta;
type Story = StoryObj<typeof meta>;

async function openDecline(canvasElement: HTMLElement, ownerKey: string, cards: CardsResponse) {
  await waitForReady(() => expect(getHomeQueryClient().getQueryData(ownerQueryKey(ownerKey, "cards"))).toEqual(cards));
  const screen = within(canvasElement.ownerDocument.body);
  await userEvent.click(await within(canvasElement).findByRole("button", { name: /^Fixture Market/ }));
  await waitForReady(async () => {
    const dialog = screen.getByRole("dialog");
    await expect(within(dialog).getByRole("alert")).toHaveTextContent("Declined because your card was locked");
    await expect(within(dialog).getByRole("alert")).toHaveTextContent("Nothing was charged.");
  });
  return { screen, dialog: within(screen.getByRole("dialog")) };
}

export const Frozen: Story = {
  play: async ({ canvasElement, args }) => {
    const { dialog } = await openDecline(canvasElement, args.ownerKey, frozenCards);
    await expect(dialog.getByRole("button", { name: "Unlock card" })).toBeVisible();
  },
};
export const Active: Story = {
  args: { session: activeSession, cards: activeCards, ownerKey: "storybook-activity-card-unlock-active" },
  play: async ({ canvasElement, args }) => {
    const { screen, dialog } = await openDecline(canvasElement, args.ownerKey, activeCards);
    await expect(dialog.queryByRole("button", { name: "Unlock card" })).toBeNull();
    await expect(dialog.queryByRole("button", { name: "Add money" })).toBeNull();
    await userEvent.click(dialog.getByRole("button", { name: "Close Fixture Market details" }));
    await waitForReady(() => expect(screen.queryByRole("dialog")).toBeNull());
    await expect(within(canvasElement).getByRole("button", { name: /^Fixture Market/ })).toBeVisible();
  },
};
export const RefetchFailed: Story = {
  args: { ownerKey: "storybook-activity-card-unlock-refetch-failed", failRefetch: true },
  play: async ({ canvasElement, args }) => {
    const { screen, dialog } = await openDecline(canvasElement, args.ownerKey, frozenCards);
    await expect(dialog.getByRole("button", { name: "Unlock card" })).toBeVisible();
    await getHomeQueryClient().refetchQueries({ queryKey: ownerQueryKey(args.ownerKey, "cards"), exact: true });
    await waitForReady(async () => {
      await expect(dialog.queryByRole("button", { name: "Unlock card" })).toBeNull();
      await expect(screen.getByRole("dialog")).toBeVisible();
      await expect(dialog.getByRole("alert")).toHaveTextContent("Declined because your card was locked");
      await expect(dialog.getByRole("alert")).toHaveTextContent("Nothing was charged.");
    });
  },
};
