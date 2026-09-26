import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { AddressField } from "@/components/address-field";

const RECIPIENT = "0x2211d1D0020DAEA8039E46Cf1367962070d77DA9";

function AddressFieldStory({ initialValue = "", disabled = false }: { initialValue?: string; disabled?: boolean }) {
  const [value, setValue] = useState(initialValue);
  return <div className="w-80 max-w-full"><AddressField id="story-recipient" label="To" value={value} onChange={setValue} disabled={disabled} /></div>;
}

const meta = {
  id: "ui-address-field",
  title: "UI/Address Field",
  component: AddressField,
  args: { id: "story-recipient", label: "To", value: "", onChange: () => {} },
  render: (args) => <AddressFieldStory initialValue={args.value} disabled={args.disabled} />,
  parameters: {
    layout: "centered",
    a11y: { test: "error" },
    design: { type: "figma", url: "https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=460-4469" },
  },
} satisfies Meta<typeof AddressField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("textbox", { name: "To" })).toHaveValue("");
    await expect(canvas.getByPlaceholderText("0x…")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Paste address" }).getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  },
};

export const Focused: Story = {
  args: { value: RECIPIENT },
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("textbox", { name: "To" });
    await userEvent.click(input);
    await expect(input).toHaveFocus();
    await expect(input).toHaveValue(RECIPIENT);
  },
};

export const Entered: Story = {
  args: { value: RECIPIENT },
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("textbox", { name: "To" });
    await expect(input).toHaveValue("0x2211…d77DA9");
    await userEvent.click(input);
    await expect(input).toHaveValue(RECIPIENT);
    await userEvent.tab();
    await expect(input).toHaveValue("0x2211…d77DA9");
  },
};

export const Disabled: Story = {
  args: { disabled: true },
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("textbox", { name: "To" })).toBeDisabled();
    await expect(canvas.getByPlaceholderText("0x…")).toHaveValue("");
    await expect(canvas.getByRole("button", { name: "Paste address" })).toBeDisabled();
  },
};

export const Paste: Story = {
  beforeEach: () => {
    const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText: async () => `  ${RECIPIENT}  ` } });
    return () => {
      if (original) Object.defineProperty(navigator, "clipboard", original);
      else Reflect.deleteProperty(navigator, "clipboard");
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Paste address" }));
    await expect(canvas.getByRole("textbox", { name: "To" })).toHaveValue("0x2211…d77DA9");
  },
};

export const InvalidText: Story = {
  args: { value: "jesse.base" },
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("textbox", { name: "To" });
    await userEvent.click(input);
    await userEvent.tab();
    await expect(input).toHaveValue("jesse.base");
  },
};
