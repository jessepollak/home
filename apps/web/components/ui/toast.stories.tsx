import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { userEvent, within } from "storybook/test";
import { Button } from "./button";
import { Toaster, toast } from "./toast";

const meta = {
  id: "ui-toast",
  title: "UI/Toast",
  component: Toaster,
  parameters: { layout: "centered", a11y: { test: "error" }, design: { type: "figma", url: "https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=161-1885" } },
} satisfies Meta<typeof Toaster>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <>
      <Button onClick={() => toast.add({ title: "Deposit confirmed", description: "25.00 USDC on Base" })}>
        Show toast
      </Button>
      <Toaster />
    </>
  ),
};

export const Stacked: Story = {
  render: () => (
    <>
      <Button
        onClick={() => {
          toast.add({ title: "Deposit confirmed", description: "25.00 USDC on Base" });
          toast.add({ title: "Saved balance updated", description: "$1,111.11" });
        }}
      >
        Show toasts
      </Button>
      <Toaster />
    </>
  ),
};

export const Success: Story = {
  render: () => (
    <>
      <Button onClick={() => toast.add({ type: "success", title: "Deposit confirmed", description: "25.00 USDC on Base" })}>Show success</Button>
      <Toaster />
    </>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Show success" }));
  },
};

export const Info: Story = {
  render: () => (
    <>
      <Button onClick={() => toast.add({ type: "info", title: "Balance updated", description: "Your latest balance is ready." })}>Show info</Button>
      <Toaster />
    </>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Show info" }));
  },
};

export const Warning: Story = {
  render: () => (
    <>
      <Button onClick={() => toast.add({ type: "warning", title: "Vault rates stale", description: "Retry to load the latest rates." })}>Show warning</Button>
      <Toaster />
    </>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Show warning" }));
  },
};

export const ErrorWithRetry: Story = {
  render: () => (
    <>
      <Button onClick={() => toast.add({ type: "error", title: "Account check unavailable", description: "Retry to check your account.", actionProps: { children: "Retry", onClick: () => {} } })}>Show error</Button>
      <Toaster />
    </>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Show error" }));
  },
};

export const Loading: Story = {
  render: () => (
    <>
      <Button onClick={() => toast.add({ type: "loading", title: "Checking account", description: "This may take a moment." })}>Show loading</Button>
      <Toaster />
    </>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Show loading" }));
  },
};
