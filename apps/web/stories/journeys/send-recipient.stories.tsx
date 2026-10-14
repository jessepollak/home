import { useCallback } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { expect, fn, userEvent, within } from "storybook/test";
import { waitForReady } from "@/tests/helpers/story-readiness";
import type { queries } from "storybook/test";
import { SendDialog } from "@/client/transfers/send-dialog";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { formatAddress } from "@/shared/formatting";
import { ACCOUNT, RECIPIENT, ACTION_ID, availableAssets, preparedAction, recipientResources, type Mode } from "./explorations/send-recipient.fixtures";
const close = fn();
const journey = { prepares: [] as Array<{ kind: string; params: unknown }> };


function SendRecipientJourney({ mode }: { mode: Mode }) {
  const fetchAccountResource = useCallback<AccountWalletClient["fetchAccountResource"]>((url) => recipientResources(mode)(url), [mode]);
  return <SendDialog
    entry="send"
    open
    immediate
    address={ACCOUNT}
    queryOwnerKey="storybook-send-recipient"
    regionId="US"
    availableAssets={availableAssets}
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

type Screen = ReturnType<typeof within<typeof queries>>;

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
  await expect(await screen.findByRole("button", { name: `Show full address ${formatAddress(RECIPIENT)}` })).toBeVisible();
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
    await expect(screen.queryByText("Or")).not.toBeInTheDocument();
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

export const PreparingReview: Story = {
  args: { mode: "prepare-loading" },
  play: async ({ canvasElement }) => {
    const screen = await toDestination(canvasElement);
    await enterRecipient(screen, RECIPIENT);
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    const continueButton = screen.getByRole("button", { name: "Continue" });
    await waitForReady(() => expect(continueButton).toHaveAttribute("aria-busy", "true"));
    await expect(continueButton).toHaveAttribute("aria-disabled", "true");
    await expect(screen.getByRole("dialog", { name: "Send" })).toBeVisible();
    await expect(screen.getByRole("textbox", { name: "To" })).toBeVisible();
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
    const reveal = within(to).getByRole("button", { name: `Show full address ${formatAddress(RECIPIENT)}` });
    await expect(reveal).toBeVisible();
    await userEvent.click(reveal);
    await waitForReady(() => expect(screen.getByLabelText(`Full address ${RECIPIENT}`)).toBeVisible());
    await userEvent.keyboard("{Escape}");
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
    await waitForReady(() => expect(close).toHaveBeenCalledTimes(1));
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
