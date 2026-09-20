import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Skeleton } from "./skeleton";

const meta = {
  id: "ui-skeleton",
  title: "UI/Skeleton",
  component: Skeleton,
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { className: "h-4 w-40" },
};

export const Stack: Story = {
  render: () => (
    <div className="flex w-56 flex-col gap-2">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-4 w-56" />
      <Skeleton className="h-4 w-40" />
    </div>
  ),
};
