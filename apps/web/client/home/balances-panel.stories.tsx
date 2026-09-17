import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { BalanceRowModel } from "@/shared/balances/present";
import { Card, CardContent } from "@/components/ui/card";
import { HomeBalanceRowView } from "./balances-panel";
import { ShimmerRows } from "./panel-shared";

const normalRow = {
  key: "storybook-usd",
  group: "cash",
  name: "US dollar",
  mark: { kind: "flag", currency: "USD" },
  primary: "$12,345.67",
  secondary: null,
  tone: "default",
} satisfies BalanceRowModel;

const unavailableRow = {
  key: "storybook-eur-unavailable",
  group: "cash",
  name: "Euro",
  mark: { kind: "flag", currency: "EUR" },
  primary: "Unavailable",
  secondary: null,
  tone: "error",
} satisfies BalanceRowModel;

const longLabelLargeAmountRow = {
  key: "storybook-long-balance",
  group: "asset",
  name: "International diversified treasury reserve position",
  mark: { kind: "symbol", symbol: "RESERVE" },
  primary: "$123,456,789,012,345,678,901,234.56",
  secondary: "99,999,999,999 RESERVE",
  tone: "default",
} satisfies BalanceRowModel;

type FinancialRowStoryProps = {
  row: BalanceRowModel;
};

function FinancialRowStory({ row }: FinancialRowStoryProps) {
  return (
    <div className="mx-auto w-full max-w-md p-2">
      <Card>
        <CardContent inset="list">
          <ul className="list-none p-0" data-balance-list="">
            <HomeBalanceRowView row={row} />
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

const meta = {
  id: "pilot-financial-row",
  title: "Pilot/Financial Row",
  component: FinancialRowStory,
  args: {
    row: normalRow,
  },
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof FinancialRowStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Normal: Story = {};

export const Loading: Story = {
  render: () => (
    <div className="mx-auto w-full max-w-md p-2">
      <Card>
        <CardContent inset="list">
          <ShimmerRows count={2} />
          <span className="sr-only">Loading balances…</span>
        </CardContent>
      </Card>
    </div>
  ),
};

export const UnavailableValue: Story = {
  args: {
    row: unavailableRow,
  },
};

export const LongLabelLargeAmount: Story = {
  args: {
    row: longLabelLargeAmountRow,
  },
  parameters: {
    viewport: {
      defaultViewport: "smallMobile",
    },
  },
};
