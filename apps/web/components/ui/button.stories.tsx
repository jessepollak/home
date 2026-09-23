import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { X } from "lucide-react";
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test";
import { Button } from "./button";

const meta = {
  id: "ui-button",
  title: "UI/Button",
  component: Button,
  args: { children: "Continue" },
  parameters: { layout: "centered" },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Button>Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Destructive</Button>
    </div>
  ),
};

export const Disabled: Story = { args: { disabled: true } };

function PressFeedbackStory() {
  const [activations, setActivations] = useState(0);
  const activate = () => setActivations((count) => count + 1);

  return (
    <div className="flex flex-col items-start gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={activate}>Primary action</Button>
        <Button variant="outline" aria-haspopup="dialog" onClick={activate}>Popup trigger</Button>
        <Button variant="ghost" size="icon" aria-label="Dismiss" onClick={activate}>
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="link" size="inline" onClick={activate}>Inline action</Button>
        <Button variant="ghost" press="none" onClick={activate}>Wide row exception</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button aria-busy="true" onClick={activate}>Busy action</Button>
        <Button disabled onClick={activate}>Disabled action</Button>
      </div>
      <p role="status">{activations} activations</p>
    </div>
  );
}

export const PressFeedback: Story = {
  render: () => <PressFeedbackStory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const status = () => canvas.getByRole("status");
    const activations = () => Number((status().textContent ?? "").replace(/\D/g, ""));
    const expectActivations = async (expected: number) => {
      await waitFor(() => expect(activations()).toBe(expected));
    };

    for (const [name, count] of [
      ["Primary action", 1],
      ["Popup trigger", 2],
      ["Dismiss", 3],
      ["Inline action", 4],
      ["Wide row exception", 5],
    ] as const) {
      await userEvent.click(canvas.getByRole("button", { name }));
      await expectActivations(count);
    }

    const busy = canvas.getByRole("button", { name: "Busy action" });
    await expect(busy).toBeEnabled();
    await userEvent.click(busy);
    await expectActivations(6);
    await expect(busy).toHaveAttribute("aria-busy", "true");

    const disabled = canvas.getByRole("button", { name: "Disabled action" });
    await expect(disabled).toBeDisabled();
    await fireEvent.click(disabled);
    await expectActivations(6);
  },
};
