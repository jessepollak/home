import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "./combobox";

type CurrencyOption = {
  value: string;
  label: string;
};

const currencies: CurrencyOption[] = [
  { value: "usd", label: "US dollar" },
  { value: "eur", label: "Euro" },
  { value: "idr", label: "Indonesian rupiah" },
];

const meta = {
  id: "ui-combobox",
  title: "UI/Combobox",
  component: Combobox,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Combobox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Combobox items={currencies} defaultValue={currencies[0]} aria-label="Currency">
      <ComboboxInput aria-label="Currency" placeholder="Search currencies" className="w-64" />
      <ComboboxContent>
        <ComboboxEmpty>No currencies found.</ComboboxEmpty>
        <ComboboxList>
          {(option: CurrencyOption) => (
            <ComboboxItem key={option.value} value={option}>
              {option.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  ),
};
