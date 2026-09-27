import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { AppErrorState } from "./app-error";

const meta = {
  id: "home-app-error",
  title: "Home/App Error",
  component: AppErrorState,
  args: { onRetry: fn() },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AppErrorState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RenderError: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toHaveTextContent("This page couldn’t load.");
    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
    await expect(args.onRetry).toHaveBeenCalledTimes(1);
  },
};
