import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";

const meta = {
  id: "ui-toggle-group",
  title: "UI/Toggle Group",
  component: ToggleGroup,
  parameters: { layout: "centered", a11y: { test: "error" }, design: { type: "figma", url: "https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=160-1849" } },
} satisfies Meta<typeof ToggleGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <ToggleGroup defaultValue={["1D"]} aria-label="Price range" variant="outline" spacing={0} className="h-11 w-72">
      {["1D", "1W", "1M", "1Y"].map((range) => (
        <ToggleGroupItem key={range} value={range} className="h-full flex-1">
          {range}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const oneDay = canvas.getByRole("button", { name: "1D" });
    const oneWeek = canvas.getByRole("button", { name: "1W" });
    await expect(canvas.getByRole("group", { name: "Price range" }).getBoundingClientRect().height).toBe(44);
    await expect(oneDay.getBoundingClientRect().height).toBe(38);
    await userEvent.tab();
    await expect(oneDay).toHaveFocus();
    await userEvent.click(oneWeek);
    await expect(oneWeek).toHaveAttribute("aria-pressed", "true");
    await expect(oneDay).toHaveAttribute("aria-pressed", "false");
  },
};

export const DefaultVariant: Story = {
  render: () => (
    <ToggleGroup defaultValue={["1D"]} aria-label="Price range" variant="default" spacing={1}>
      {["1D", "1W", "1M", "1Y"].map((range) => (
        <ToggleGroupItem key={range} value={range}>{range}</ToggleGroupItem>
      ))}
    </ToggleGroup>
  ),
};

export const Vertical: Story = {
  render: () => (
    <ToggleGroup defaultValue={["1D"]} aria-label="Price range" variant="outline" orientation="vertical" spacing={0} className="w-28">
      {["1D", "1W", "1M"].map((range) => (
        <ToggleGroupItem key={range} value={range}>{range}</ToggleGroupItem>
      ))}
    </ToggleGroup>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <ToggleGroup defaultValue={["1D"]} aria-label="Range with unavailable option" variant="outline">
        <ToggleGroupItem value="1D">1D</ToggleGroupItem>
        <ToggleGroupItem value="1W" disabled>1W</ToggleGroupItem>
      </ToggleGroup>
      <ToggleGroup defaultValue={["1D"]} aria-label="Unavailable ranges" variant="outline" disabled>
        <ToggleGroupItem value="1D">1D</ToggleGroupItem>
        <ToggleGroupItem value="1W">1W</ToggleGroupItem>
      </ToggleGroup>
    </div>
  ),
};
