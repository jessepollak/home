import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Input } from "./input";

const meta = {
  id: "ui-input",
  title: "UI/Input",
  component: Input,
  args: { "aria-label": "Amount", placeholder: "0.00" },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Invalid: Story = { args: { "aria-invalid": true, defaultValue: "999" } };

export const VerificationCode: Story = {
  args: { "aria-label": "Verification code", variant: "otp", defaultValue: "123456" },
};
