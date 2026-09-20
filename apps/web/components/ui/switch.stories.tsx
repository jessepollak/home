import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Switch } from "./switch";

const meta = {
  id: "ui-switch",
  title: "UI/Switch",
  component: Switch,
  args: { "aria-label": "Show small balances" },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Checked: Story = { args: { defaultChecked: true } };

export const Disabled: Story = { args: { disabled: true } };
