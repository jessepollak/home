import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";

const meta = {
  id: "ui-toggle-group",
  title: "UI/Toggle Group",
  component: ToggleGroup,
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof ToggleGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <ToggleGroup defaultValue={["1D"]} aria-label="Price range" variant="outline" spacing={0}>
      {["1D", "1W", "1M", "1Y"].map((range) => (
        <ToggleGroupItem key={range} value={range}>
          {range}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  ),
};
