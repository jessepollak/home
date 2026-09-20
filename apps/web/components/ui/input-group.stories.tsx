import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from "./input-group";

const meta = {
  id: "ui-input-group",
  title: "UI/Input Group",
  component: InputGroup,
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof InputGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <InputGroup className="w-72">
      <InputGroupAddon>
        <InputGroupText>USDC</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput aria-label="Amount" inputMode="decimal" placeholder="0.00" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton>Max</InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const StackedLabel: Story = {
  render: () => (
    <InputGroup className="w-72">
      <InputGroupAddon align="block-start">
        <InputGroupText>Recipient address</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput aria-label="Recipient address" placeholder="0x" />
    </InputGroup>
  ),
};
