import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Textarea } from "./textarea";

const meta = {
  id: "ui-textarea",
  title: "UI/Textarea",
  component: Textarea,
  args: { "aria-label": "Note", placeholder: "Add a note" },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Invalid: Story = { args: { "aria-invalid": true } };
