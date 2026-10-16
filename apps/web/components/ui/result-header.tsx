import { StatusMark, statusTextClass, type StatusTexture } from "./status-texture";
import { cn } from "cn";

type ResultOutcome = "success" | "pending" | "failed" | "unknown";

export function ResultHeader({ outcome, title, description, headingLevel = 3, textTone = "texture" }: {
  outcome: ResultOutcome;
  title: string;
  description?: string;
  headingLevel?: 2 | 3;
  textTone?: "texture" | "foreground";
}) {
  const texture = { success: "done", pending: "working", failed: "failed", unknown: "working" } as const satisfies Record<ResultOutcome, StatusTexture>;
  const status = texture[outcome];
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div role="status" aria-atomic="true" className="flex flex-col items-center gap-4 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <StatusMark texture={status} className="size-6" />
      </div>
      <div className="flex max-w-xs flex-col items-center gap-1">
        <Heading className={cn("text-base font-semibold", textTone === "foreground" ? "text-foreground" : statusTextClass(status, "title"))}>{title}</Heading>
        {description ? <p className={cn("text-sm", textTone === "foreground" ? "text-foreground" : statusTextClass(status, "body"))}>{description}</p> : null}
      </div>
    </div>
  );
}
