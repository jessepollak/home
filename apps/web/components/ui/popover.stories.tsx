import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { waitForReady } from "@/tests/helpers/story-readiness";
import { Button } from "./button";
import { Popover, PopoverContent, PopoverDescription, PopoverTrigger } from "./popover";

function PopoverExample() {
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" />}>Details</PopoverTrigger>
      <PopoverContent aria-label="Details">
        <PopoverDescription>Some balances are unavailable</PopoverDescription>
      </PopoverContent>
    </Popover>
  );
}

const meta = {
  id: "ui-popover",
  title: "UI/Popover",
  component: PopoverExample,
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof PopoverExample>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  parameters: { library: { render: "frame" } },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Details" }));
    const body = within(canvasElement.ownerDocument.body);
    await waitForReady(() => expect(body.getByText("Some balances are unavailable")).toBeVisible());
  },
};
