import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./card";
import { Button } from "./button";

const meta = {
  id: "ui-card",
  title: "UI/Card",
  component: Card,
  parameters: { layout: "centered", a11y: { test: "error" }, design: { type: "figma", url: "https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=269-5270" } },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <CardTitle>Save</CardTitle>
        <CardDescription>Base USDC vault</CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm">Details</Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="text-sm tabular-nums">$1,111.11</p>
      </CardContent>
      <CardFooter>
        <Button className="w-full">Deposit</Button>
      </CardFooter>
    </Card>
  ),
};

export const ListInset: Story = {
  render: () => (
    <Card className="w-80">
      <CardContent inset="list">
        <ul className="flex list-none flex-col gap-1 p-0">
          <li className="rounded-lg px-3 py-2 text-sm">Steakhouse USDC</li>
          <li className="rounded-lg px-3 py-2 text-sm">Gauntlet USDC Prime</li>
        </ul>
      </CardContent>
    </Card>
  ),
};
