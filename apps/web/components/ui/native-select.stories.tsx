import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NativeSelect, NativeSelectOption } from "./native-select";

const meta = {
  id: "ui-native-select",
  title: "UI/Native Select",
  component: NativeSelect,
  args: { "aria-label": "Sort coverage" },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof NativeSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <NativeSelect {...args} defaultValue="gdp">
      <NativeSelectOption value="gdp">GDP</NativeSelectOption>
      <NativeSelectOption value="alphabetical">Alphabetical</NativeSelectOption>
    </NativeSelect>
  ),
};
