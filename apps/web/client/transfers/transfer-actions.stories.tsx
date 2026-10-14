import { useEffect, useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { AccountWalletClientProvider, type AccountWalletClient } from "@/client/account/cdp-client";
import { cashoutFixtureProviders } from "@/tests/browser/feature-map/cashout-fixture";
import { availableAssets, recipientResources } from "@/stories/journeys/explorations/send-recipient.fixtures";
import { wallet as storyWallet } from "@/stories/journeys/explorations/home-pull-to-refresh.fixtures";
import { waitForReady } from "@/tests/helpers/story-readiness";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { encodeUsdcTransfer } from "@/shared/transfers/transfer-helpers";
import { HomeShellRoutingProvider, readHomeInboundPanelState, type HomeShellRouting } from "@/client/home/panel-routing";
import type { ShellFlow } from "@/config/shell-location";
import { TransferActions } from "./transfer-actions";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const RECIPIENT = "0x2211d1D0020DAEA8039E46Cf1367962070d77DA9" as const;
const ACTION_ID = "11111111-1111-4111-8111-111111111111";
const pausedSend: PreparedMoneyAction = {
  id: ACTION_ID, kind: "send", title: "Send USDC",
  createdAt: "2026-10-07T10:35:00.000Z", expiresAt: "2099-10-07T10:45:00.000Z",
  owner: { subject: "transfer-actions-story", address: ACCOUNT, chainId: 8453, accountProvider: "cdp-embedded" },
  amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "spend" }],
  calls: [{ to: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", data: encodeUsdcTransfer(RECIPIENT, BigInt(1000000)), value: "0" }],
  warnings: [],
};

const wallet: AccountWalletClient = {
  ...storyWallet,
  prepareMoneyAction: async () => pausedSend,
  resumeMoneyAction: async () => pausedSend,
  executeMoneyAction: async () => ({ id: ACTION_ID, status: "submitted" }),
  fetchAccountResource: async (url: string) => url.startsWith("/api/funding/providers")
    ? cashoutFixtureProviders
    : recipientResources("recent")(url),
};

function storyScreen(canvasElement: HTMLElement) {
  return within(canvasElement.ownerDocument.body);
}

async function openedDialog(canvasElement: HTMLElement, name: string) {
  const dialog = await storyScreen(canvasElement).findByRole("dialog", { name });
  await waitForReady(() => expect(dialog).not.toHaveAttribute("data-starting-style"));
  return dialog;
}

const meta = {
  id: "transfers-transfer-actions",
  title: "Transfers/Transfer actions",
  component: TransferActions,
  decorators: [(Story) => <AccountWalletClientProvider client={wallet}><div style={{ width: 390 }}><Story /></div></AccountWalletClientProvider>],
  parameters: { layout: "fullscreen" },
  args: { availableAssets, regionId: "US" },
} satisfies Meta<typeof TransferActions>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SendOffTriggers: Story = {
  args: { sendOffered: false, initialFlow: null, initialActionId: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole("button", { name: /^Cash out$/ })).toHaveLength(1);
    await expect(canvas.queryByRole("button", { name: /^Send$/ })).toBeNull();
  },
};

export const SendOffPausedSendReview: Story = {
  args: { sendOffered: false, initialFlow: "send", initialActionId: ACTION_ID },
  play: async ({ canvasElement }) => {
    const dialog = await openedDialog(canvasElement, "Confirm");
    await waitForReady(() => expect(within(dialog).getByRole("button", { name: "Send $1.00" })).toBeVisible());
    await expect(within(dialog).queryByRole("textbox", { name: "To" })).toBeNull();
  },
};

export const SendOffPausedReviewBack: Story = {
  args: { sendOffered: false, initialFlow: "send", initialActionId: ACTION_ID },
  play: async ({ canvasElement }) => {
    const dialog = await openedDialog(canvasElement, "Confirm");
    await waitForReady(() => expect(within(dialog).getByRole("button", { name: "Send $1.00" })).toBeVisible());
    await userEvent.click(within(dialog).getAllByRole("button", { name: "Back" })[0]);
    await waitForReady(() => expect(within(dialog).getByRole("textbox", { name: "Amount" })).toBeVisible());
    await expect(within(dialog).queryByRole("button", { name: "Send $1.00" })).toBeNull();
  },
};

export const SendOffBareFlow: Story = {
  args: { sendOffered: false, initialFlow: "send", initialActionId: null },
  play: async ({ canvasElement }) => {
    const dialog = await openedDialog(canvasElement, "Cash out");
    await waitForReady(() => expect(within(dialog).getByRole("button", { name: "Continue" })).toBeVisible());
    await expect(within(dialog).queryByRole("textbox", { name: "To" })).toBeNull();
  },
};

const noop = () => undefined;
const offeringChanges = new EventTarget();

function OfferingFlipHarness({ initialSendOffered = false }: { initialSendOffered?: boolean }) {
  const [sendOffered, setSendOffered] = useState(initialSendOffered);
  const [routeFlow, setRouteFlow] = useState<ShellFlow | null>("send");
  useEffect(() => {
    const turnOn = () => setSendOffered(true);
    const turnOff = () => setSendOffered(false);
    const close = () => setRouteFlow(null);
    const reopen = () => setRouteFlow("send");
    offeringChanges.addEventListener("send-on", turnOn);
    offeringChanges.addEventListener("send-off", turnOff);
    offeringChanges.addEventListener("close", close);
    offeringChanges.addEventListener("reopen", reopen);
    return () => {
      offeringChanges.removeEventListener("send-on", turnOn);
      offeringChanges.removeEventListener("send-off", turnOff);
      offeringChanges.removeEventListener("close", close);
      offeringChanges.removeEventListener("reopen", reopen);
    };
  }, []);
  const routing: HomeShellRouting = useMemo(() => ({
    state: readHomeInboundPanelState(
      { panel: "home", account: null, shelf: null, asset: null, market: null },
      new URLSearchParams(routeFlow ? `flow=${routeFlow}` : ""),
    ),
    popRevision: 0,
    rootRequest: null,
    openPanel: noop,
    pushRoute: noop,
    leaveRoute: noop,
    canOpenAssetDetail: () => false,
    openAssetDetail: () => false,
    setFlow: (next) => { setRouteFlow(next); return true; },
    clearFlow: () => setRouteFlow(null),
  }), [routeFlow]);
  return (
    <HomeShellRoutingProvider value={routing}>
      <div data-send-offered={sendOffered}>
        <TransferActions availableAssets={availableAssets} regionId="US" sendOffered={sendOffered} />
      </div>
    </HomeShellRoutingProvider>
  );
}

export const SendOffBareFlowOfferingTurnsOn: Story = {
  render: () => <OfferingFlipHarness />,
  play: async ({ canvasElement }) => {
    const screen = storyScreen(canvasElement);
    const dialog = await openedDialog(canvasElement, "Cash out");
    offeringChanges.dispatchEvent(new Event("send-on"));
    await waitForReady(() => expect(screen.getByRole("dialog", { name: "Cash out" })).toBeVisible());
    await expect(screen.queryByRole("dialog", { name: "Send" })).toBeNull();
    await waitForReady(() => expect(within(dialog).getByRole("textbox", { name: "Amount" })).toBeVisible());
  },
};

export const SendOffBareFlowReopensAfterOfferingTurnsOff: Story = {
  render: () => <OfferingFlipHarness initialSendOffered />,
  play: async ({ canvasElement }) => {
    const screen = storyScreen(canvasElement);
    await openedDialog(canvasElement, "Send");
    offeringChanges.dispatchEvent(new Event("close"));
    await waitForReady(() => expect(screen.queryByRole("dialog")).toBeNull());
    offeringChanges.dispatchEvent(new Event("send-off"));
    offeringChanges.dispatchEvent(new Event("reopen"));
    await waitForReady(() => expect(screen.getByRole("dialog", { name: "Cash out" })).toBeVisible());
    await expect(screen.queryByRole("dialog", { name: "Send" })).toBeNull();
  },
};
