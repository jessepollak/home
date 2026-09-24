import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PiggyBank } from "lucide-react";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemSeparator, ItemTitle } from "./item";

const meta = {
  id: "ui-item",
  title: "UI/Item",
  component: Item,
  parameters: { layout: "centered", design: { type: "figma", url: "https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=161-1818" } },
} satisfies Meta<typeof Item>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <ItemGroup className="w-80">
      <Item variant="outline">
        <ItemMedia variant="icon" aria-hidden="true">
          <PiggyBank />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Steakhouse USDC</ItemTitle>
          <ItemDescription>3.85%</ItemDescription>
        </ItemContent>
        <ItemActions>
          <ItemTitle numeric>$123.46</ItemTitle>
        </ItemActions>
      </Item>
      <ItemSeparator />
      <Item variant="flush">
        <ItemContent>
          <ItemTitle tone="muted">Gauntlet USDC Prime</ItemTitle>
          <ItemDescription lines={1}>Long vault names truncate to a single line.</ItemDescription>
        </ItemContent>
        <ItemActions>
          <ItemTitle numeric>—</ItemTitle>
        </ItemActions>
      </Item>
    </ItemGroup>
  ),
};
