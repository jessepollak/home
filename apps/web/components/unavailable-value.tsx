export function UnavailableValue({ variant = "inline" }: { variant?: "inline" | "hero" }) {
  if (variant === "hero") {
    return <div className="flex items-baseline gap-3"><span className="text-4xl font-semibold" aria-hidden="true">—</span><span className="text-sm text-muted-foreground">Value unavailable</span></div>;
  }
  return <><span aria-hidden="true">—</span><span className="sr-only">Value unavailable</span></>;
}
