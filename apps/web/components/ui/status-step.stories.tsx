import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { StatusStep, StatusSteps } from "./status-step";

const meta = {
  id: "ui-status-step",
  title: "UI/StatusStep",
  component: StatusStep,
  args: { status: "complete", title: "Submitted", time: "10:35 AM" },
  parameters: { layout: "centered", a11y: { test: "error" }, design: { type: "figma", url: "https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=166-1861" } },
} satisfies Meta<typeof StatusStep>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Complete: Story = { render: (args) => <div className="w-80"><StatusSteps><StatusStep {...args} /></StatusSteps></div> };
export const Current: Story = { args: { status: "current", title: "Confirming on Base", time: undefined }, render: Complete.render };
export const Upcoming: Story = { args: { status: "upcoming", title: "Next step", time: undefined }, render: Complete.render };
export const Failed: Story = { args: { status: "failed", title: "Confirmation failed", time: undefined }, render: Complete.render };
export const PendingList: Story = {
  render: () => <div className="w-80"><StatusSteps><StatusStep status="complete" title="Submitted" time="10:35 AM" /><StatusStep status="current" title="Confirming on Base" /></StatusSteps></div>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const items = canvas.getAllByRole("listitem");
    await expect(items).toHaveLength(2);
    await expect(items[0]).toHaveTextContent("Complete: Submitted");
    await expect(items[1]).toHaveTextContent("In progress: Confirming on Base");
    await expect(items[0].querySelector('[data-slot="step-connector"]')).not.toBeNull();
    await expect(items[1].querySelector('[data-slot="step-connector"]')).not.toBeNull();
  },
};
