import { useRef } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { Button } from "./button";
import { Toaster, toast } from "./toast";

const meta = {
  id: "ui-toast",
  title: "UI/Toast",
  component: Toaster,
  parameters: { layout: "centered", a11y: { test: "error" } },
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
  parameters: { library: { render: "frame" } },
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

export const Dark: Story = { ...Success, globals: { theme: "dark" } };

export const Info: Story = {
  parameters: { library: { render: "frame" } },
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
  parameters: { library: { render: "frame" } },
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
  parameters: { library: { render: "frame" } },
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
  parameters: { library: { render: "frame" } },
  render: () => (
    <>
      <Button onClick={() => toast.add({ type: "loading", title: "Checking account", description: "This may take a moment." })}>Show loading</Button>
      <Toaster />
    </>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Show loading" }));
    await expect(await within(canvasElement.ownerDocument.body).findByText("Checking account")).toBeVisible();
    await expect(canvasElement.ownerDocument.querySelector('[data-slot="status-spinner"]')).toBeVisible();
  },
};

export const PromiseSuccess: Story = {
  render: function PromiseToast() {
    const resolve = useRef(() => {});
    return (
      <>
        <Button onClick={() => {
          const pending = new Promise<void>((complete) => { resolve.current = complete; });
          void toast.promise(pending, {
            loading: { title: "Checking account", description: "This may take a moment." },
            success: { title: "Account checked", description: "Your account is ready." },
            error: "Account check unavailable",
          });
        }}>Check account</Button>
        <Button onClick={() => resolve.current()}>Complete check</Button>
        <Toaster />
      </>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole("button", { name: "Check account" }));
    const pending = await body.findByRole("dialog", { name: "Checking account" });
    await expect(pending.querySelector('[data-slot="status-spinner"]')).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Complete check" }));
    const done = await body.findByRole("dialog", { name: "Account checked" });
    await expect(done).toHaveAttribute("data-type", "success");
    await expect(done.querySelector('[data-slot="toast-icon"] svg')).toBeVisible();
    await expect(done.querySelector('[data-slot="status-spinner"]')).not.toBeInTheDocument();
  },
};
