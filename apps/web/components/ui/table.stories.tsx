import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";

const meta = {
  id: "ui-table",
  title: "UI/Table",
  component: Table,
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof Table>;

export default meta;
type Story = StoryObj<typeof meta>;

const rows = [
  { country: "United States", currency: "USD", asset: "USDC" },
  { country: "Brazil", currency: "BRL", asset: "Not configured" },
];

export const Default: Story = {
  render: () => (
    <Table>
      <TableCaption>Country coverage</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Country</TableHead>
          <TableHead scope="col">Currency</TableHead>
          <TableHead scope="col">Asset</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.country}>
            <TableHead scope="row">{row.country}</TableHead>
            <TableCell>{row.currency}</TableCell>
            <TableCell>{row.asset}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
};
