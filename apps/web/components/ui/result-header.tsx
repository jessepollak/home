import { CircleCheck, CircleHelp, CircleX, Clock } from "lucide-react";

type ResultOutcome = "success" | "pending" | "failed" | "unknown";

export function ResultHeader({ outcome, title, description }: {
  outcome: ResultOutcome;
  title: string;
  description?: string;
}) {
  const Icon = {
    success: CircleCheck,
    pending: Clock,
    failed: CircleX,
    unknown: CircleHelp,
  }[outcome];
  return (
    <div role="status" aria-atomic="true" className="flex flex-col items-center gap-4 text-center">
      <div className={`flex size-12 items-center justify-center rounded-full ${outcome === "failed" ? "bg-destructive/10" : "bg-muted"}`}>
        <Icon aria-hidden="true" className={`size-6 ${outcome === "failed" ? "text-destructive" : outcome === "success" ? "text-foreground" : "text-muted-foreground"}`} />
      </div>
      <div className="flex max-w-xs flex-col items-center gap-1">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
    </div>
  );
}
