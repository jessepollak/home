import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { useState } from "react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "./input-otp";

function Code({ initial = "", invalid = false, disabled = false }: { initial?: string; invalid?: boolean; disabled?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="w-72">
      <label htmlFor="story-otp">Verification code</label>
      <InputOTP
        id="story-otp"
        value={value}
        onChange={setValue}
        maxLength={6}
        pattern={REGEXP_ONLY_DIGITS}
        pasteTransformer={(pasted) => pasted.replace(/\D/g, "").slice(0, 6)}
        aria-invalid={invalid || undefined}
        disabled={disabled}
      >
        <InputOTPGroup>
          {Array.from({ length: 6 }, (_, index) => <InputOTPSlot key={index} index={index} />)}
        </InputOTPGroup>
      </InputOTP>
    </div>
  );
}

const meta = {
  id: "ui-input-otp",
  title: "UI/InputOTP",
  component: InputOTP,
  args: { maxLength: 6, children: <InputOTPGroup>{Array.from({ length: 6 }, (_, index) => <InputOTPSlot key={index} index={index} />)}</InputOTPGroup> },
  parameters: {
    layout: "centered",
    a11y: { test: "error" },
    design: { type: "figma", url: "https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=211-3668" },
  },
} satisfies Meta<typeof InputOTP>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  render: () => <Code />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("textbox", { name: "Verification code" });
    await userEvent.click(input);
    await userEvent.type(input, "123456");
    await expect(input).toHaveValue("123456");
    await expect(canvasElement.querySelectorAll('[data-slot="input-otp-slot"]')).toHaveLength(6);
    for (const [index, slot] of Array.from(canvasElement.querySelectorAll('[data-slot="input-otp-slot"]')).entries()) {
      await expect(slot).toHaveTextContent(String(index + 1));
    }
    await userEvent.clear(input);
    await userEvent.paste("012-345");
    await expect(input).toHaveValue("012345");
  },
};

export const Filled: Story = { render: () => <Code initial="123456" /> };
export const Error: Story = { render: () => <Code initial="123456" invalid /> };
export const Disabled: Story = { render: () => <Code initial="123456" disabled /> };
