import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { PromptInput, PromptInputSubmit, PromptInputTextarea } from "./prompt-input";

function PromptInputDemo({ busy, onSubmit, onStop }: { busy: boolean; onSubmit: (text: string) => void; onStop: () => void }) {
  const [text, setText] = useState("");
  return <PromptInput className="w-80" onSubmit={(event) => { event.preventDefault(); onSubmit(text); setText(""); }}>
    <PromptInputTextarea aria-label="Message" placeholder="Ask a question" value={text} onChange={(event) => setText(event.currentTarget.value)} />
    <PromptInputSubmit busy={busy} disabled={!text.trim()} onStop={onStop} />
  </PromptInput>;
}

const meta = {
  id: "ui-prompt-input",
  title: "UI/Prompt input",
  component: PromptInputDemo,
  args: { busy: false, onSubmit: fn(), onStop: fn() },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof PromptInputDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Send" })).toBeDisabled();
    await userEvent.type(canvas.getByRole("textbox", { name: "Message" }), "Where is my money?");
    await userEvent.click(canvas.getByRole("button", { name: "Send" }));
    await expect(args.onSubmit).toHaveBeenCalledWith("Where is my money?");
  },
};

export const Streaming: Story = {
  args: { busy: true },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Stop" }));
    await expect(args.onStop).toHaveBeenCalled();
  },
};
