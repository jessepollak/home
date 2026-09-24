import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Bold } from "lucide-react";
import { Toggle } from "./toggle";

const meta = {
  id: "ui-toggle",
  title: "UI/Toggle",
  component: Toggle,
  args: { "aria-label": "Bold" },
  parameters: { layout: "centered", a11y: { test: "error" }, design: { type: "figma", url: "https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=160-1826" } },
} satisfies Meta<typeof Toggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Toggle {...args}>
      <Bold aria-hidden="true" />
    </Toggle>
  ),
};

export const Pressed: Story = {
  args: { defaultPressed: true },
  render: Default.render,
  parameters: { docs: { description: { story: "The pressed default keeps the toggle visibly active without interaction." } } },
};

export const Disabled: Story = {
  args: { disabled: true },
  render: Default.render,
};
