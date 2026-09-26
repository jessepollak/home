import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { LoadErrorCard, LoadRetryButton } from "./load-error";

function LoadErrorStory({ onRetry, card }: { onRetry: () => void; card: boolean }) {
  return card ? (
    <LoadErrorCard title="Data unavailable" description="Current values could not be verified." tone="destructive" onRetry={onRetry} />
  ) : <LoadRetryButton onRetry={onRetry} />;
}

const meta = {
  id: "ui-load-error",
  title: "UI/Load Error",
  component: LoadErrorStory,
  args: { onRetry: fn(), card: true },
  parameters: { layout: "centered" },
} satisfies Meta<typeof LoadErrorStory>;

export default meta;
type Story = StoryObj<typeof meta>;

async function verify(canvasElement: HTMLElement, onRetry: () => void) {
  const button = within(canvasElement).getByRole("button", { name: "Try again" });
  await expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  await userEvent.click(button);
  await expect(onRetry).toHaveBeenCalledTimes(1);
}

export const Card: Story = {
  play: async ({ canvasElement, args }) => {
    await expect(within(canvasElement).getByRole("alert")).toBeTruthy();
    await verify(canvasElement, args.onRetry);
  },
};

export const InlineButton: Story = {
  args: { card: false },
  play: async ({ canvasElement, args }) => verify(canvasElement, args.onRetry),
};
