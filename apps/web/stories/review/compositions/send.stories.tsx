import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { HttpResponse, http } from "msw";
import { expect, userEvent, within } from "storybook/test";
import { SendDialog } from "@/client/transfers/send-dialog";
import { fetchStoryResource } from "../../journeys/explorations/home-pull-to-refresh.fixtures";
import { ACCOUNT, RECIPIENT, ACTION_ID, availableAssets, preparedAction, sendRecipientHandlers } from "../../journeys/explorations/send-recipient.fixtures";

type State = "ready" | "preparing";
const action = preparedAction(RECIPIENT);

function SendComposition({ state }: { state: State }) {
  const [open, setOpen] = useState(true);
  return <SendDialog open={open} immediate address={ACCOUNT} queryOwnerKey="storybook-send-recipient" regionId="US"
    availableAssets={availableAssets} fetchAccountResource={fetchStoryResource}
    prepareMoneyAction={async () => state === "preparing" ? new Promise<never>(() => {}) : action}
    resumeMoneyAction={async () => action}
    executeMoneyAction={async (prepared) => ({ id: prepared.id, status: "submitted" })}
    onClose={() => setOpen(false)} />;
}

const meta = {
  title: "Compositions/Send",
  component: SendComposition,
  args: { state: "ready" },
  parameters: {
    layout: "fullscreen",
    library: { render: "frame", order: 3 },
    viewport: { viewports: { phone390: { name: "390 × 844", styles: { width: "390px", height: "844px" } } }, defaultViewport: "phone390" },
    a11y: { test: "error" },
    msw: { handlers: [...sendRecipientHandlers, http.get("/api/actions", () => HttpResponse.json({ actions: [{
      id: action.id, owner: action.owner, provider: "cdp-embedded", kind: action.kind, status: "confirmed",
      createdAt: action.createdAt, confirmedAt: action.createdAt,
      summary: { title: action.title, amounts: action.amounts, warnings: action.warnings, expiresAt: action.expiresAt },
    }] }))] },
  },
} satisfies Meta<typeof SendComposition>;
export default meta;
type Story = StoryObj<typeof meta>;

async function recipientStep(canvasElement: HTMLElement) {
  const screen = within(canvasElement.ownerDocument.body);
  const dialog = await screen.findByRole("dialog", { name: "Send" });
  await userEvent.type(within(dialog).getByRole("textbox", { name: "Amount" }), "1");
  await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
  await screen.findByRole("textbox", { name: "To" });
  return screen;
}

async function reviewStep(canvasElement: HTMLElement) {
  const screen = await recipientStep(canvasElement);
  const recent = await screen.findByRole("group", { name: "Recent recipients" });
  await userEvent.click(within(recent).getByRole("button", { name: /jesse\.base\.eth/ }));
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("dialog", { name: "Confirm" });
  return screen;
}

export const Send: Story = {
  name: "Send Recipient",
  play: async ({ canvasElement }) => {
    const screen = await recipientStep(canvasElement);
    await expect(await screen.findByRole("group", { name: "Recent recipients" })).toBeVisible();
  },
};
export const SendReview: Story = {
  name: "Send Review",
  play: async ({ canvasElement }) => {
    const screen = await reviewStep(canvasElement);
    await expect(screen.getByRole("button", { name: "Send $1.00" })).toHaveAttribute("data-money-action-id", ACTION_ID);
  },
};
export const SendSent: Story = {
  name: "Send Sent",
  play: async ({ canvasElement }) => {
    const screen = await reviewStep(canvasElement);
    await userEvent.click(screen.getByRole("button", { name: "Send $1.00" }));
    await expect(await screen.findByRole("heading", { name: "$1.00 sent" })).toBeVisible();
  },
};
export const SendLoading: Story = {
  args: { state: "preparing" },
  play: async ({ canvasElement }) => {
    const screen = await recipientStep(canvasElement);
    await userEvent.type(screen.getByRole("textbox", { name: "To" }), RECIPIENT);
    await userEvent.tab();
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await expect(screen.getByRole("button", { name: "Continue" })).toHaveAttribute("aria-busy", "true");
  },
};
export const SendError: Story = {
  play: async ({ canvasElement }) => {
    const screen = await recipientStep(canvasElement);
    await userEvent.type(screen.getByRole("textbox", { name: "To" }), "missing.base.eth");
    await userEvent.tab();
    await expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't resolve missing.base.eth.");
  },
};
