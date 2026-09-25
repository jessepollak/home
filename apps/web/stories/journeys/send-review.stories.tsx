import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import {
  MoneyConfirmSummary,
  moneyConfirmFromRow,
} from "@/client/money-modal/confirm-summary";
import { CopyableValue } from "@/components/copyable-value";

const RECIPIENT = "0x2211d1d0020daea8039e46cf1367962070d77da9";
const SHORT_RECIPIENT = "0x2211…d77da9";

function SendReviewStory() {
  return (
    <main className="w-full max-w-[390px] px-6 py-4">
      <MoneyConfirmSummary
        amount="$25.00"
        lead="You're sending USDC"
        rows={[
          moneyConfirmFromRow({
            subject: "storybook-send-owner",
            address: "0x1111111111111111111111111111111111111111",
            chainId: 8453,
            accountProvider: "cdp-embedded",
          }),
          {
            label: "To",
            value: (
              <CopyableValue
                value={RECIPIENT}
                presentation="reveal"
                valueKind="address"
                className="-my-3 justify-end"
              />
            ),
          },
          { label: "Asset", value: "USDC" },
          { label: "Network", value: "Base" },
        ]}
      />
    </main>
  );
}

async function expectReviewAddress(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const trigger = canvas.getByRole("button", { name: `Show full address ${SHORT_RECIPIENT}` });
  const text = canvas.getByText(SHORT_RECIPIENT, { exact: true });
  const toRow = canvas.getByText("To", { exact: true }).nextElementSibling;
  if (!(toRow instanceof HTMLElement)) throw new Error("To value is missing");
  const range = document.createRange();
  range.selectNodeContents(text);

  await expect(canvas.getByText("You're sending USDC")).toBeVisible();
  await expect(range.getClientRects().length).toBe(1);
  await expect(toRow.scrollWidth).toBeLessThanOrEqual(toRow.clientWidth + 1);
  await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  await expect(trigger.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  await userEvent.click(trigger);

  const popover = await within(document.body).findByRole("dialog", { name: "Full address" });
  const bounds = popover.getBoundingClientRect();
  await expect(within(popover).getByLabelText(`Full address ${RECIPIENT}`).textContent).toBe(RECIPIENT);
  await expect(bounds.left).toBeGreaterThanOrEqual(0);
  await expect(bounds.right).toBeLessThanOrEqual(window.innerWidth);
  await expect(popover.scrollWidth).toBeLessThanOrEqual(popover.clientWidth + 1);
  await waitFor(() => expect(within(popover).getByRole("button", { name: "Copy address" })).toBeVisible());
}

const meta = {
  id: "journeys-send-review",
  title: "Journeys/Send Review",
  component: SendReviewStory,
  parameters: { layout: "fullscreen", viewport: { defaultViewport: "mobile" } },
} satisfies Meta<typeof SendReviewStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Mobile390: Story = {
  play: async ({ canvasElement }) => { await expectReviewAddress(canvasElement); },
};

export const Mobile320: Story = {
  parameters: { viewport: { defaultViewport: "smallMobile" } },
  play: async ({ canvasElement }) => { await expectReviewAddress(canvasElement); },
};
