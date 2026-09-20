import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

const meta = {
  id: "ui-select",
  title: "UI/Select",
  component: Select,
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Select defaultValue="usdc">
      <SelectTrigger aria-label="Asset" className="w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="usdc">USDC</SelectItem>
        <SelectItem value="eurc">EURC</SelectItem>
      </SelectContent>
    </Select>
  ),
};
