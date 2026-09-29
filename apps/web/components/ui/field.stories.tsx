import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSeparator, FieldSet, FieldTitle } from "./field";
import { Input } from "./input";

const meta = {
  id: "ui-field",
  title: "UI/Field",
  component: Field,
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <FieldSet className="w-72">
      <FieldLegend>Recipient</FieldLegend>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="ui-field-email">Email</FieldLabel>
          <Input id="ui-field-email" type="email" placeholder="you@example.com" />
          <FieldDescription>We send the verification code here.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="ui-field-amount">Amount</FieldLabel>
          <Input id="ui-field-amount" placeholder="0.00" />
          <FieldError>Enter a positive USDC amount.</FieldError>
        </Field>
        <FieldSeparator>or</FieldSeparator>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldTitle>Verified account</FieldTitle>
            <FieldDescription>Base smart account</FieldDescription>
          </FieldContent>
        </Field>
      </FieldGroup>
    </FieldSet>
  ),
};
