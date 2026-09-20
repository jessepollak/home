import type { Meta, StoryObj } from "@storybook/nextjs-vite";
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
