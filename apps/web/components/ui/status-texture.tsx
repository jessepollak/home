import { CircleAlert, CircleCheck, CircleX, Clock, LoaderCircle, TriangleAlert } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "cn";

export type StatusTexture = "settled" | "working" | "needs-you" | "cant-load" | "failed" | "done" | "loading";

type StatusTextPart = "title" | "body" | "context" | "amount";

const textClasses = {
  settled: { title: "text-foreground", body: "text-foreground", context: "text-muted-foreground", amount: "text-foreground" },
  working: { title: "text-muted-foreground", body: "text-muted-foreground", context: "text-muted-foreground", amount: "text-muted-foreground" },
  "needs-you": { title: "text-foreground", body: "text-foreground", context: "text-muted-foreground", amount: "text-foreground" },
  "cant-load": { title: "text-foreground", body: "text-foreground", context: "text-muted-foreground", amount: "text-foreground" },
  failed: { title: "text-destructive", body: "text-foreground", context: "text-muted-foreground", amount: "text-foreground" },
  done: { title: "text-foreground", body: "text-foreground", context: "text-muted-foreground", amount: "text-foreground" },
  loading: { title: "text-muted-foreground", body: "text-muted-foreground", context: "text-muted-foreground", amount: "text-muted-foreground" },
} satisfies Record<StatusTexture, Record<StatusTextPart, string>>;

export function statusTextClass(texture: StatusTexture, part: StatusTextPart, gain = false) {
  return part === "amount" && gain && (texture === "settled" || texture === "done")
    ? "text-market-gain"
    : textClasses[texture][part];
}

export function StatusSpinner({ className, ...props }: ComponentProps<typeof LoaderCircle>) {
  return <LoaderCircle aria-hidden="true" className={cn("motion-safe:animate-spin", className)} {...props} />;
}

export function StatusMark({ texture, gain = false, className }: {
  texture: StatusTexture;
  gain?: boolean;
  className?: string;
}) {
  if (texture === "settled" || texture === "loading") return null;
  if (texture === "working") {
    return <>
      <LoaderCircle aria-hidden="true" data-slot="status-spinner" className={cn("size-4 shrink-0 text-muted-foreground motion-safe:animate-spin motion-reduce:hidden", className)} />
      <Clock aria-hidden="true" data-slot="status-clock" className={cn("hidden size-4 shrink-0 text-muted-foreground motion-reduce:block", className)} />
    </>;
  }
  const Icon = { "needs-you": TriangleAlert, "cant-load": CircleAlert, failed: CircleX, done: CircleCheck }[texture];
  return <Icon aria-hidden="true" className={cn("size-4 shrink-0", texture === "needs-you" ? "text-warning" : texture === "cant-load" ? "text-muted-foreground" : texture === "failed" ? "text-destructive" : gain ? "text-market-gain" : "text-foreground", className)} />;
}
