import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

export function ChartLoadFallback({ failed, retry }: { failed: boolean; retry: () => void }) {
  return <section className="min-w-0" aria-label="Market price history">
    <div role="status" aria-label={failed ? "Couldn't load price history" : "Loading price history"}
      dir="ltr" className="relative -mx-4 h-64 min-w-0 overflow-hidden">
      {failed ? <div className="absolute inset-0 bg-(--asset-surface,var(--color-background))">
        <Empty><EmptyHeader><EmptyTitle>{"Couldn't load price history"}</EmptyTitle></EmptyHeader>
          <Button variant="outline" size="touch" onClick={retry}>Try again</Button>
        </Empty>
      </div> : <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-muted-foreground/20" />}
    </div>
    <div aria-hidden="true" className="mt-2 h-11" />
  </section>;
}
