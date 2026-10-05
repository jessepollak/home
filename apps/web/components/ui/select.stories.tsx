import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { waitForReady } from "@/tests/helpers/story-readiness";
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
    <Select defaultValue="usdc" items={[{ value: "usdc", label: "USDC" }, { value: "eurc", label: "EURC" }]}>
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

export const Dark: Story = {
  parameters: { library: { render: "frame" } },
  ...Default,
  globals: { theme: "dark" },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("combobox", { name: "Asset" }));
    const popup = await within(canvasElement.ownerDocument.body).findByRole("listbox");
    await expect(canvasElement.contains(popup)).toBe(false);
    await waitForReady(() => expect(popup).toBeVisible());
  },
};

const longListItems = Array.from({ length: 40 }, (_, index) => ({
  value: `asset-${index + 1}`, label: `Asset ${index + 1}`,
}));

export const LongListFallback: Story = {
  render: () => (
    <Select defaultValue="asset-1" items={longListItems}>
      <SelectTrigger aria-label="Asset" className="w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {longListItems.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
      </SelectContent>
    </Select>
  ),
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("combobox", { name: "Asset" });
    await userEvent.click(trigger);
    const list = await within(canvasElement.ownerDocument.body).findByRole("listbox");
    await waitForReady(() => expect(list).toBeVisible());
    const last = within(list).getByRole("option", { name: "Asset 40" });
    last.scrollIntoView({ block: "nearest" });
    await waitForReady(async () => {
      await expect(list.scrollTop).toBeGreaterThan(0);
      await expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(list.getBoundingClientRect().bottom + 1);
    });
    await userEvent.click(last);
    await expect(trigger).toHaveTextContent("Asset 40");
  },
};
