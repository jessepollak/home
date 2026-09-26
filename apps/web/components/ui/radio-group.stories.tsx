import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { FieldError, FieldTitle } from "./field";
import { RadioGroup, RadioGroupOption, RadioGroupSegment } from "./radio-group";

const meta = {
  id: "ui-radio-group",
  title: "UI/RadioGroup",
  component: RadioGroup,
  parameters: { layout: "centered", a11y: { test: "error" }, design: { type: "figma", url: "https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=160-1801" } },
} satisfies Meta<typeof RadioGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

function PaymentMethods({ descriptions = false, disabled = false, singleDisabled = false, error = false }: { descriptions?: boolean; disabled?: boolean; singleDisabled?: boolean; error?: boolean }) {
  const titleId = React.useId();
  const errorId = React.useId();
  return (
    <div className="grid w-72 gap-3">
      <FieldTitle id={titleId}>Payment method</FieldTitle>
      <RadioGroup aria-labelledby={titleId} aria-describedby={error ? errorId : undefined} defaultValue="chase" disabled={disabled} aria-invalid={error || undefined}>
        {[
          { id: "chase", label: "Chase checking •••• 4821", description: "Available today" },
          { id: "savings", label: "Savings •••• 1234", description: "Takes one business day" },
        ].map((option) => (
          <RadioGroupOption key={option.id} value={option.id} label={option.label} description={descriptions ? option.description : undefined} disabled={singleDisabled && option.id === "savings"} invalid={error} />
        ))}
      </RadioGroup>
      {error ? <FieldError id={errorId}>Choose a payment method.</FieldError> : null}
    </div>
  );
}

export const Default: Story = {
  render: () => <PaymentMethods />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const first = canvas.getByRole("radio", { name: "Chase checking •••• 4821" });
    const second = canvas.getByRole("radio", { name: "Savings •••• 1234" });
    await userEvent.tab();
    await expect(first).toHaveFocus();
    await expect(first).toHaveAttribute("aria-checked", "true");
    await userEvent.click(canvas.getByText("Savings •••• 1234"));
    await expect(second).toHaveAttribute("aria-checked", "true");
    first.focus();
    await expect(first).toHaveAttribute("aria-checked", "false");
    await expect(second).toHaveAttribute("aria-checked", "true");
    second.focus();
    await userEvent.keyboard("{ArrowDown}");
    await expect(first).toHaveFocus();
    await expect(first).toHaveAttribute("aria-checked", "true");
    await userEvent.keyboard("{ArrowUp}");
    await expect(second).toHaveFocus();
    await expect(second).toHaveAttribute("aria-checked", "true");
  },
};

export const WithDescriptions: Story = { render: () => <PaymentMethods descriptions /> };
export const Disabled: Story = { render: () => <div className="flex flex-col gap-8"><PaymentMethods disabled /><PaymentMethods singleDisabled /></div> };
export const Error: Story = { render: () => <PaymentMethods error /> };

export const Segmented: Story = {
  render: () => (
    <div className="w-72">
      <RadioGroup variant="segmented" aria-label="Appearance" defaultValue="light">
        <RadioGroupSegment value="light">Light</RadioGroupSegment>
        <RadioGroupSegment value="dark">Dark</RadioGroupSegment>
        <RadioGroupSegment value="system">System</RadioGroupSegment>
      </RadioGroup>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const light = canvas.getByRole("radio", { name: "Light" });
    const dark = canvas.getByRole("radio", { name: "Dark" });
    await userEvent.tab();
    await expect(light).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(dark).toHaveFocus();
    await expect(dark).toHaveAttribute("aria-checked", "true");
  },
};
