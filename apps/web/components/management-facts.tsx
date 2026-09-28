export function ManagementFacts({ rows }: { rows: Array<[string, string]> }) {
  return <dl>{rows.map(([label, value]) => (
    <div key={label} className="grid min-h-11 grid-cols-[auto_1fr] items-center gap-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-end tabular-nums wrap-anywhere">{value}</dd>
    </div>
  ))}</dl>;
}
