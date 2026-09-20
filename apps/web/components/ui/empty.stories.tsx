import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ArrowDownToLine } from "lucide-react";
import { Button } from "./button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./empty";

const meta = {
  id: "ui-empty",
  title: "UI/Empty",
  component: Empty,
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof Empty>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Empty className="w-80">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ArrowDownToLine aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>Nothing saved yet</EmptyTitle>
        <EmptyDescription>Deposit USDC to start earning the vault rate.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button>Get started</Button>
      </EmptyContent>
    </Empty>
  ),
};
