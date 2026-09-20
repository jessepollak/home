import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Input } from "./input";
import { Label } from "./label";

const meta = {
  id: "ui-label",
  title: "UI/Label",
  component: Label,
  args: { children: "Amount" },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof Label>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div className="grid w-56 gap-2">
      <Label {...args} htmlFor="ui-label-amount" />
      <Input id="ui-label-amount" placeholder="0.00" />
    </div>
  ),
};
