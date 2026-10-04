import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NativeSelect } from "./select";

const meta = {
  id: "explorations-native-select",
  title: "Explorations/Native Select",
  component: NativeSelect,
  args: { "aria-label": "Sort coverage" },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof NativeSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <NativeSelect {...args} wrapperClassName="w-44" defaultValue="gdp">
      <option value="gdp">GDP, highest first</option>
      <option value="alphabetical">Alphabetical</option>
    </NativeSelect>
  ),
};

export const Grouped: Story = {
  args: { "aria-label": "Portfolio" },
  render: (args) => (
    <NativeSelect {...args} wrapperClassName="w-44" defaultValue="">
      <option value="">All</option>
      <optgroup label="Ranking">
        <option value="gdp">GDP</option>
        <option value="alphabetical">Alphabetical</option>
      </optgroup>
    </NativeSelect>
  ),
};
