import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { expect, fireEvent, fn, userEvent, waitFor, within } from "storybook/test";
import { Button } from "./button";

const meta = {
  id: "ui-button",
  title: "UI/Button",
  component: Button,
  args: { children: "Continue" },
  parameters: { layout: "centered", design: { type: "figma", url: "https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=12-27" } },
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

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="default">Default</Button>
      <Button size="sm">Small</Button>
      <Button size="lg">Large</Button>
      <Button size="touch">Touch</Button>
      <Button size="icon-xs" aria-label="Extra small icon"><X aria-hidden="true" /></Button>
      <Button size="icon-sm" aria-label="Small icon"><X aria-hidden="true" /></Button>
      <Button size="icon" aria-label="Icon"><X aria-hidden="true" /></Button>
      <Button size="icon-lg" aria-label="Large icon"><X aria-hidden="true" /></Button>
    </div>
  ),
};

function TouchStory() {
  const [activations, setActivations] = useState(0);
  return (
    <div className="flex w-80 flex-col items-stretch gap-2">
      <Button size="touch" onClick={() => setActivations((count) => count + 1)}>Primary touch</Button>
      <Button size="touch" variant="outline" onClick={() => setActivations((count) => count + 1)}>
        <Plus data-icon="inline-start" aria-hidden="true" />Outline touch
      </Button>
      <Button size="touch" disabled>Disabled touch</Button>
      <Button size="touch" aria-busy="true">Busy touch</Button>
      <Button size="touch">Retry loading more memes from the category after your connection is restored</Button>
      <p role="status">{activations} activations</p>
    </div>
  );
}

export const Touch: Story = {
  render: () => <TouchStory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const buttons = ["Primary touch", "Outline touch", "Disabled touch", "Busy touch", "Retry loading more memes from the category after your connection is restored"].map((name) => canvas.getByRole("button", { name }));
    for (const button of buttons) {
      await expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
    const longLabel = buttons[4];
    await expect(longLabel.scrollWidth).toBeLessThanOrEqual(longLabel.clientWidth);
    await expect(longLabel.getBoundingClientRect().height).toBeGreaterThan(44);
    await expect(buttons[2]).toBeDisabled();
    await expect(buttons[3]).toHaveAttribute("aria-busy", "true");
    await userEvent.click(buttons[0]);
    await userEvent.click(buttons[1]);
    await expect(canvas.getByRole("status")).toHaveTextContent("2 activations");
  },
};

export const Disabled: Story = { args: { disabled: true } };

export const Loading: Story = {
  args: { loading: true, onClick: fn() },
  play: async ({ canvasElement, args }) => {
    const button = within(canvasElement).getByRole("button", { name: "Continue" });
    await expect(button).toHaveAttribute("aria-busy", "true");
    await expect(button).toHaveAccessibleName("Continue");
    await fireEvent.click(button);
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};

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
