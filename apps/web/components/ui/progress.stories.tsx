import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { Button } from "./button";
import { Progress } from "./progress";

function AdvancingProgress() {
  const [value, setValue] = useState(1);

  return (
    <div className="flex flex-col items-start gap-4">
      <Progress label="Identity check" value={value} max={3} />
      <Button onClick={() => setValue((current) => Math.min(current + 1, 3))} disabled={value === 3}>
        Next step
      </Button>
    </div>
  );
}

const meta = {
  id: "ui-progress",
  title: "UI/Progress",
  component: Progress,
  args: { label: "Identity check", value: 2, max: 3 },
  decorators: [(Story) => <div className="w-[326px]"><Story /></div>],
  parameters: { layout: "centered", a11y: { test: "error" }, design: { type: "figma", url: "https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=161-1923" } },
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Active: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const progressbar = canvas.getByRole("progressbar", { name: "Identity check" });
    await expect(progressbar).toHaveAttribute("aria-valuenow", "2");
    await expect(progressbar).toHaveAttribute("aria-valuemin", "0");
    await expect(progressbar).toHaveAttribute("aria-valuemax", "3");
    await expect(progressbar).toHaveAttribute("aria-valuetext", "2 of 3");
    await expect(canvas.getByText("2 of 3")).toBeVisible();
    const track = canvasElement.querySelector('[data-slot="progress-track"]')!.getBoundingClientRect();
    const indicator = canvasElement.querySelector('[data-slot="progress-indicator"]')!.getBoundingClientRect();
    await expect(indicator.width / track.width).toBeCloseTo(2 / 3, 2);
  },
};

export const Complete: Story = {
  args: { value: 3 },
  play: async ({ canvasElement }) => {
    const progressbar = within(canvasElement).getByRole("progressbar", { name: "Identity check" });
    await expect(progressbar).toHaveAttribute("aria-valuetext", "3 of 3");
    await expect(progressbar).toHaveAttribute("data-complete");
    const track = canvasElement.querySelector('[data-slot="progress-track"]')!.getBoundingClientRect();
    const indicator = canvasElement.querySelector('[data-slot="progress-indicator"]')!.getBoundingClientRect();
    await expect(indicator.width).toBeCloseTo(track.width, 1);
  },
};

export const NotStarted: Story = {
  args: { value: 0 },
  play: async ({ canvasElement }) => {
    const progressbar = within(canvasElement).getByRole("progressbar", { name: "Identity check" });
    await expect(progressbar).toHaveAttribute("aria-valuenow", "0");
    await expect(progressbar).toHaveAttribute("aria-valuetext", "0 of 3");
  },
};

export const Loading: Story = {
  args: { value: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const progressbar = canvas.getByRole("progressbar", { name: "Identity check" });
    await expect(progressbar).not.toHaveAttribute("aria-valuenow");
    await expect(progressbar).toHaveAttribute("aria-valuetext", "indeterminate progress");
    await expect(canvas.queryByText(/of 3/)).toBeNull();
  },
};

export const RightToLeft: Story = {
  render: (args) => <div dir="rtl"><Progress {...args} /></div>,
  play: async ({ canvasElement }) => {
    const progressbar = within(canvasElement).getByRole("progressbar", { name: "Identity check" });
    const track = canvasElement.querySelector('[data-slot="progress-track"]');
    const indicator = canvasElement.querySelector('[data-slot="progress-indicator"]');
    await expect(progressbar).toHaveAttribute("aria-valuetext", "2 of 3");
    await expect(track).not.toBeNull();
    await expect(indicator).not.toBeNull();
    await expect(indicator!.getBoundingClientRect().width / track!.getBoundingClientRect().width).toBeCloseTo(2 / 3, 2);
    await expect(indicator!.getBoundingClientRect().right).toBeCloseTo(track!.getBoundingClientRect().right, 1);
  },
};

export const Advancing: Story = {
  render: () => <AdvancingProgress />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const progressbar = canvas.getByRole("progressbar", { name: "Identity check" });
    const next = canvas.getByRole("button", { name: "Next step" });
    await expect(progressbar).toHaveAttribute("aria-valuetext", "1 of 3");
    await userEvent.click(next);
    await expect(progressbar).toHaveAttribute("aria-valuetext", "2 of 3");
    await userEvent.click(next);
    await expect(progressbar).toHaveAttribute("aria-valuenow", "3");
    await expect(progressbar).toHaveAttribute("aria-valuetext", "3 of 3");
    await expect(progressbar).toHaveAttribute("data-complete");
    await expect(next).toBeDisabled();
  },
};
