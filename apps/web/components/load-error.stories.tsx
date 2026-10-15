import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { LoadErrorCard, LoadRetryButton } from "./load-error";

function LoadErrorStory({ onRetry, card, texture, title = "Data unavailable", description = "Current values could not be verified." }: { onRetry: () => void; card: boolean; texture: "cant-load" | "failed"; title?: string; description?: string }) {
  return card ? (
    <LoadErrorCard title={title} description={description} texture={texture} onRetry={onRetry} />
  ) : <LoadRetryButton onRetry={onRetry} />;
}

const meta = {
  id: "ui-load-error",
  title: "UI/Load Error",
  component: LoadErrorStory,
  args: { onRetry: fn(), card: true, texture: "cant-load" },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof LoadErrorStory>;

export default meta;
type Story = StoryObj<typeof meta>;

async function verify(canvasElement: HTMLElement, onRetry: () => void) {
  await expect(within(canvasElement).getAllByRole("button")).toHaveLength(1);
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

export const CantLoad: Story = { ...Card };
export const Failed: Story = { ...Card, args: { texture: "failed", title: "Deposit failed", description: "Your money is still in your account." } };
export const Dark: Story = { ...CantLoad, globals: { theme: "dark" } };
export const FailedDark: Story = { ...Failed, globals: { theme: "dark" } };
