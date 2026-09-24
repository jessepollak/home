import type { Meta, StoryObj } from "@storybook/nextjs-vite";
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
