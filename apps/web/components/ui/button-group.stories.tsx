import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { expect, within } from "storybook/test";
import { Button } from "./button";
import { ButtonGroup } from "./button-group";

const meta = {
  id: "ui-button-group",
  title: "UI/Button Group",
  component: ButtonGroup,
  args: { "aria-label": "Pager" },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof ButtonGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Stepper: Story = {
  render: (args) => (
    <ButtonGroup {...args}>
      <Button variant="outline" size="touch" aria-label="Previous"><ChevronLeftIcon /></Button>
      <Button variant="outline" size="touch">3 of 12</Button>
      <Button variant="outline" size="touch" aria-label="Next"><ChevronRightIcon /></Button>
    </ButtonGroup>
  ),
  play: async ({ canvasElement }) => {
    const group = within(canvasElement).getByRole("group", { name: "Pager" });
    await expect(within(group).getAllByRole("button")).toHaveLength(3);
  },
};
