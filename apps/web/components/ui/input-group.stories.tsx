import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { XIcon } from "lucide-react";
import { expect, userEvent, within } from "storybook/test";
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

export const IconButtonPress: Story = {
  render: () => (
    <InputGroup className="w-72">
      <InputGroupInput aria-label="Amount" inputMode="decimal" placeholder="0.00" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" aria-label="Clear amount" onClick={(event) => {
          const input = event.currentTarget.closest("[data-slot=input-group]")?.querySelector("input");
          if (input) input.value = "";
        }}>
          <XIcon className="size-3.5" aria-hidden="true" />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("textbox", { name: "Amount" });
    await userEvent.type(input, "12");
    await expect(input).toHaveValue("12");
    await userEvent.click(canvas.getByRole("button", { name: "Clear amount" }));
    await expect(input).toHaveValue("");
  },
};
