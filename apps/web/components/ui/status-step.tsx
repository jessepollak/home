import { Circle, CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent } from "./card";

export type StepStatus = "complete" | "current" | "upcoming" | "failed";

export function StatusSteps({ children }: { children: ReactNode }) {
  return <Card variant="flush"><CardContent inset="list"><ol className="flex flex-col px-3 py-2">{children}</ol></CardContent></Card>;
}

export function StatusStep({ status, title, time, showConnector = true }: {
  status: StepStatus;
  title: string;
  time?: string;
  showConnector?: boolean;
}) {
  const Icon = {
    complete: CircleCheck,
    current: LoaderCircle,
    upcoming: Circle,
    failed: CircleX,
  }[status];
  const statusText = {
    complete: "Complete",
    current: "In progress",
    upcoming: "Not started",
    failed: "Failed",
  }[status];
  return (
    <li className="group/step flex min-h-12 gap-3 last:min-h-0">
      <div aria-hidden="true" className="flex w-4 shrink-0 flex-col items-center gap-1 pt-0.5">
        <Icon className={`size-4 shrink-0 ${status === "complete" ? "text-foreground" : status === "current" ? "text-primary motion-safe:animate-spin" : status === "failed" ? "text-destructive" : "text-muted-foreground"}`} />
        {showConnector ? <span data-slot="step-connector" className={`w-0.5 flex-1 rounded-full group-last/step:hidden ${status === "complete" ? "bg-foreground" : "bg-border"}`} /> : null}
      </div>
      <div className="flex flex-col gap-0.5 pb-2">
        <span className="sr-only">{statusText}: </span>
        <span className={`text-sm font-medium ${status === "upcoming" ? "text-muted-foreground" : "text-foreground"}`}>{title}</span>
        {time ? <span className="text-xs text-muted-foreground">{time}</span> : null}
      </div>
    </li>
  );
}
