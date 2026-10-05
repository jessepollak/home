import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, screen, userEvent, within } from "storybook/test";
import { waitForReady } from "@/tests/helpers/story-readiness";
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
  parameters: { layout: "centered", a11y: { test: "error" } },
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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox", { name: "Currency" });
    await userEvent.click(canvas.getByRole("button", { name: "Currency options" }));
    await waitForReady(() => expect(screen.getByRole("option", { name: "Euro" })).toBeVisible());
    await expect(input).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await waitForReady(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    const group = canvasElement.querySelector("[data-slot=input-group]");
    if (!(group instanceof HTMLElement)) throw new Error("Missing combobox input group");
    await userEvent.click(group);
    await waitForReady(() => expect(screen.getByRole("option", { name: "Euro" })).toBeVisible());
    await expect(input).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect(input).toHaveValue("Euro");
  },
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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Currency options" })).toBeInTheDocument();
  },
};

export const CustomTriggerLabel: Story = {
  render: () => (
    <Combobox items={currencies} defaultValue={currencies[0]} aria-label="Currency">
      <ComboboxInput aria-label="Currency" triggerLabel="Choose currency" placeholder="Search currencies" className="w-64" />
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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Choose currency" })).toBeInTheDocument();
  },
};
