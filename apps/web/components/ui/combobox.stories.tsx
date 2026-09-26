import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Combobox, ComboboxCollection, ComboboxContent, ComboboxEmpty, ComboboxGroup, ComboboxGroupLabel, ComboboxInput, ComboboxItem, ComboboxList } from "./combobox";

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
  parameters: { layout: "centered", design: { type: "figma", url: "https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=160-1759" } },
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

const groupedCurrencies = [
  { value: "Americas", items: [currencies[0]] },
  { value: "Europe and Asia", items: currencies.slice(1) },
];

export const Grouped: Story = {
  render: () => (
    <Combobox<CurrencyOption> items={groupedCurrencies} aria-label="Currency">
      <ComboboxInput aria-label="Currency" placeholder="Search currencies" className="w-64" />
      <ComboboxContent>
        <ComboboxEmpty>No currencies found.</ComboboxEmpty>
        <ComboboxList>
          {(group: { value: string; items: CurrencyOption[] }) => (
            <ComboboxGroup key={group.value} items={group.items}>
              <ComboboxGroupLabel>{group.value}</ComboboxGroupLabel>
              <ComboboxCollection>
                {(option: CurrencyOption) => (
                  <ComboboxItem key={option.value} value={option}>{option.label}</ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  ),
};
