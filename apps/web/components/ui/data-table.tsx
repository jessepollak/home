"use client";

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type DataTableProps<TData> = {
  columns: ColumnDef<TData>[];
  data: TData[];
  caption: string;
  density?: "default" | "compact";
};

export function DataTable<TData>({ columns, data, caption, density = "default" }: DataTableProps<TData>) {
  // TanStack Table intentionally returns mutable table functions; this recipe does not pass them to memoized children.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <Table className={density === "compact" ? "min-w-[44rem]" : "min-w-3xl"}>
      <caption className="sr-only">{caption}</caption>
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <TableHead className={density === "compact" ? "h-9 px-1.5" : undefined} key={header.id} scope="col">
                {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow id={`country-${String((row.original as { countryCode?: string }).countryCode ?? row.id)}`} key={row.id}>
            {row.getVisibleCells().map((cell, index) => index === 0 ? (
              <th className={density === "compact" ? "px-1.5 py-0 text-left align-middle font-semibold whitespace-nowrap" : "p-2 text-left align-middle font-semibold whitespace-nowrap"} key={cell.id} scope="row">
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </th>
            ) : (
              <TableCell className={density === "compact" ? "px-1.5 py-0" : undefined} key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
