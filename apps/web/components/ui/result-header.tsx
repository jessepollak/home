import { StatusMark, statusTextClass, type StatusTexture } from "./status-texture";
import { cn } from "cn";

type ResultOutcome = "success" | "pending" | "failed" | "unknown";

export function ResultHeader({ outcome, title, description }: {
  outcome: ResultOutcome;
  title: string;
  description?: string;
}) {
  const texture = { success: "done", pending: "working", failed: "failed", unknown: "working" } as const satisfies Record<ResultOutcome, StatusTexture>;
  const status = texture[outcome];
  return (
    <div role="status" aria-atomic="true" className="flex flex-col items-center gap-4 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <StatusMark texture={status} className="size-6" />
      </div>
      <div className="flex max-w-xs flex-col items-center gap-1">
        <h3 className={cn("text-base font-semibold", statusTextClass(status, "title"))}>{title}</h3>
        {description ? <p className={cn("text-sm", statusTextClass(status, "body"))}>{description}</p> : null}
      </div>
    </div>
  );
}
