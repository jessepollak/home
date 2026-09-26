import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Badge } from "./badge";
import { Kbd, KbdGroup } from "./kbd";

const meta = {
  id: "ui-kbd",
  title: "UI/Kbd",
  component: Kbd,
  args: { children: "⌘K" },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof Kbd>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Group: Story = {
  render: () => (
    <KbdGroup>
      <Kbd>Shift</Kbd>
      <Kbd>?</Kbd>
    </KbdGroup>
  ),
};

export const InBadge: Story = {
  render: () => (
    <Badge>
      Press <Kbd>Esc</Kbd> to exit
    </Badge>
  ),
};

export const InverseInBadge: Story = {
  render: () => (
    <Badge>
      Interacting with <strong>Savings</strong> · <Kbd variant="inverse">Esc</Kbd> to exit
    </Badge>
  ),
};
