import { useCallback } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { SendDialog } from "@/client/transfers/send-dialog";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { getTransferAsset } from "@/shared/transfers/transfer-helpers";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const RECIPIENT = "0x2211d1D0020DAEA8039E46Cf1367962070d77DA9" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const ACTION_ID = "11111111-1111-4111-8111-111111111111";
const recent = [{ address: RECIPIENT, name: "jesse.base.eth" }, { address: OTHER, name: null }];
const close = fn();
const journey = { prepares: [] as Array<{ kind: string; params: unknown }> };

type Mode = "default" | "name-loading" | "prepare-loading" | "providers-error" | "recent";

function preparedAction(recipient: `0x${string}`): PreparedMoneyAction {
  return {
    id: ACTION_ID,
    kind: "send",
    title: "Send USDC",
    createdAt: "2099-09-12T12:00:00.000Z",
    expiresAt: "2099-09-12T12:10:00.000Z",
    calls: [],
    amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "spend" }],
    warnings: [`Recipient: ${recipient}`],
    owner: { subject: "storybook-send-recipient", address: ACCOUNT, chainId: 8453, accountProvider: "cdp-embedded" },
  };
}

function SendRecipientJourney({ mode }: { mode: Mode }) {
  const fetchAccountResource = useCallback<AccountWalletClient["fetchAccountResource"]>(async (url) => {
      if (url.startsWith("/api/funding/providers")) {
        if (mode === "providers-error") throw new Error("Providers unavailable");
        return { version: 2, direction: "offramp", providers: [] };
      }
      if (url.startsWith("/api/funding/offramp/orders")) return { version: 3, recoveryEligible: false, orders: [] };
      if (url.startsWith("/api/transfers/recent-recipients")) return { version: 1, recipients: mode === "recent" ? recent : [] };
      if (url.startsWith("/api/actions/network-fee")) return { version: 1, usdcReserveBaseUnits: null };
      if (url.startsWith("/api/transfers/recipient-name")) {
        const name = new URL(url, "https://home.test").searchParams.get("name");
        if (name === "example.base.eth") {
          if (mode === "name-loading") return await new Promise<unknown>(() => {});
          return { version: 1, name, address: RECIPIENT };
        }
        throw Object.assign(new Error("Name unresolved"), { status: 404, code: "RECIPIENT_NAME_UNRESOLVED" });
      }
      throw new Error(`Unexpected account resource: ${url}`);
  }, [mode]);
  return <SendDialog
    open
    immediate
    address={ACCOUNT}
    ownerBoundary="storybook-send-recipient"
    regionId="US"
    availableAssets={[{ ...getTransferAsset("usdc")!, balanceBaseUnits: "25000000", balanceLabel: "$25.00" }]}
    fetchAccountResource={fetchAccountResource}
    prepareMoneyAction={async (kind, params) => {
      journey.prepares.push({ kind, params });
      if (mode === "prepare-loading") return await new Promise<PreparedMoneyAction>(() => {});
      return preparedAction((params as { recipient: `0x${string}` }).recipient);
    }}
    resumeMoneyAction={async () => new Promise<PreparedMoneyAction>(() => {})}
    executeMoneyAction={async () => new Promise<never>(() => {})}
    onClose={close}
  />;
}

const meta = {
  id: "journeys-send-recipient",
  title: "Journeys/Send Recipient",
  component: SendRecipientJourney,
  args: { mode: "default" },
  parameters: { layout: "fullscreen", viewport: { defaultViewport: "mobile" } },
  beforeEach: () => {
    journey.prepares.length = 0;
    close.mockClear();
  },
} satisfies Meta<typeof SendRecipientJourney>;

export default meta;
type Story = StoryObj<typeof meta>;

type Screen = ReturnType<typeof within>;

async function enterAmount(screen: Screen, amount: string) {
  const dialog = await screen.findByRole("dialog", { name: "Send" });
  await userEvent.type(within(dialog).getByRole("textbox", { name: "Amount" }), amount);
  await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
  await screen.findByRole("textbox", { name: "To" });
}

function storyScreen(canvasElement: HTMLElement) {
  return within(canvasElement.ownerDocument.body);
}

async function toDestination(canvasElement: HTMLElement) {
  const screen = storyScreen(canvasElement);
  await enterAmount(screen, "1");
  return screen;
}

async function enterRecipient(screen: Screen, value: string) {
  const input = screen.getByRole("textbox", { name: "To" });
  await userEvent.clear(input);
  await userEvent.type(input, value);
  await userEvent.tab();
  return input;
}

async function expectResolved(screen: Screen) {
  await expect(await screen.findByRole("button", { name: `Copy ${RECIPIENT}` })).toBeVisible();
  await expect(screen.getByText("Resolves to")).toBeVisible();
  await expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
}

async function playResolved(canvasElement: HTMLElement) {
  const screen = await toDestination(canvasElement);
  await enterRecipient(screen, "example.base.eth");
  await expectResolved(screen);
  return screen;
}

export const AddressEntry: Story = {
  play: async ({ canvasElement }) => {
    const screen = await toDestination(canvasElement);
    const input = await enterRecipient(screen, RECIPIENT);
    await expect(input).toHaveValue("0x2211…d77DA9");
    await expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  },
};

export const NameResolving: Story = {
  args: { mode: "name-loading" },
  play: async ({ canvasElement }) => {
    const screen = await toDestination(canvasElement);
    await enterRecipient(screen, "example.base.eth");
    await expect(screen.getByText("Resolving example.base.eth…")).toBeVisible();
    await expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  },
};

export const NameResolved: Story = {
  play: async ({ canvasElement }) => { await playResolved(canvasElement); },
};

export const NameUnresolved: Story = {
  play: async ({ canvasElement }) => {
    const screen = await toDestination(canvasElement);
    await enterRecipient(screen, "missing.base.eth");
    await expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't resolve missing.base.eth. Check the name and try again.");
    await expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  },
};

export const UnresolvedRecovery: Story = {
  play: async ({ canvasElement }) => {
    const screen = await toDestination(canvasElement);
    await enterRecipient(screen, "missing.base.eth");
    await expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't resolve missing.base.eth. Check the name and try again.");
    await enterRecipient(screen, "example.base.eth");
    await expectResolved(screen);
  },
};

export const InvalidInput: Story = {
  play: async ({ canvasElement }) => {
    const screen = await toDestination(canvasElement);
    const input = await enterRecipient(screen, "jesse");
    await expect(screen.getByText("Enter a 0x address or a name like example.base.eth.")).toBeVisible();
    await expect(input).toHaveAttribute("aria-describedby", "send-recipient-status");
    await expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  },
};

export const EmptyNoSuggestions: Story = {
  play: async ({ canvasElement }) => {
    const screen = await toDestination(canvasElement);
    await expect(screen.getByRole("textbox", { name: "To" })).toHaveValue("");
    await expect(screen.getByText("Or")).toBeVisible();
    await expect(await screen.findByText("Cash out isn't available in United States yet.")).toBeVisible();
    await expect(screen.queryByRole("group", { name: "Recent recipients" })).not.toBeInTheDocument();
    await expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  },
};

export const RecentSelection: Story = {
  args: { mode: "recent" },
  play: async ({ canvasElement }) => {
    const screen = await toDestination(canvasElement);
    const group = await screen.findByRole("group", { name: "Recent recipients" });
    const named = within(group).getByRole("button", { name: /jesse\.base\.eth/ });
    await expect(named).toHaveTextContent("0x2211…d77DA9");
    await expect(within(group).getByRole("button", { name: "0x2222…222222" })).toBeVisible();
    await userEvent.click(named);
    await expect(screen.getByRole("textbox", { name: "To" })).toHaveValue("0x2211…d77DA9");
    await expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  },
};

export const CashOutUnavailable: Story = {
  args: { mode: "providers-error" },
  play: async ({ canvasElement }) => {
    const screen = await toDestination(canvasElement);
    await expect(await screen.findByText("Cash out is unavailable right now.")).toBeVisible();
    await expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  },
};

export const PreparingReview: Story = {
  args: { mode: "prepare-loading" },
  play: async ({ canvasElement }) => {
    const screen = await toDestination(canvasElement);
    await enterRecipient(screen, RECIPIENT);
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await expect(await screen.findByText("Preparing review…")).toBeVisible();
    await expect(journey.prepares).toHaveLength(1);
  },
};

export const ContinueToReview: Story = {
  play: async ({ canvasElement }) => {
    const screen = await toDestination(canvasElement);
    await enterRecipient(screen, RECIPIENT);
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    const dialog = await screen.findByRole("dialog", { name: "Confirm" });
    await expect(within(dialog).getByText("You're sending USDC")).toBeVisible();
    const to = within(dialog).getByText("To", { exact: true }).closest("div");
    if (!to) throw new Error("To review row not found");
    await expect(within(to).getByRole("button", { name: `Copy ${RECIPIENT}` })).toBeVisible();
    await expect(within(dialog).getByRole("button", { name: "Send $1.00" })).toHaveAttribute("data-money-action-id", ACTION_ID);
    await expect(journey.prepares).toEqual([{ kind: "send", params: { assetId: "usdc", recipient: RECIPIENT, amountBaseUnits: "1000000" } }]);
  },
};

export const BackAndClose: Story = {
  play: async ({ canvasElement }) => {
    const screen = await toDestination(canvasElement);
    await enterRecipient(screen, RECIPIENT);
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    const confirm = await screen.findByRole("dialog", { name: "Confirm" });
    const footerBack = within(confirm).getAllByRole("button", { name: "Back" }).at(-1);
    if (!footerBack) throw new Error("Review Back not found");
    await userEvent.click(footerBack);
    await expect(screen.getByRole("textbox", { name: "To" })).toHaveValue("0x2211…d77DA9");
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    await expect(await screen.findByRole("dialog", { name: "Send" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await expect(screen.getByRole("textbox", { name: "To" })).toHaveValue("0x2211…d77DA9");
    await userEvent.click(screen.getByRole("button", { name: "Close send dialog" }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  },
};

export const Desktop: Story = {
  parameters: { viewport: { defaultViewport: "desktop" } },
  play: async ({ canvasElement }) => { await playResolved(canvasElement); },
};

export const Mobile320: Story = {
  parameters: { viewport: { defaultViewport: "smallMobile" } },
  play: async ({ canvasElement }) => {
    await playResolved(canvasElement);
  },
};
