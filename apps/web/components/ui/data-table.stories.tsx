import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "./data-table";

type CoverageRow = {
  country: string;
  currency: string;
};

const columns: ColumnDef<CoverageRow>[] = [
  { accessorKey: "country", header: "Country" },
  { accessorKey: "currency", header: "Currency" },
];

const data: CoverageRow[] = [
  { country: "United States", currency: "USD" },
  { country: "Brazil", currency: "BRL" },
];

const meta = {
  id: "ui-data-table",
  title: "UI/Data Table",
  component: DataTable<CoverageRow>,
  args: { columns, data, caption: "Country coverage", density: "compact" },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof DataTable<CoverageRow>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
