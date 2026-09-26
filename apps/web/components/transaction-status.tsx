import { Badge } from "@/components/ui/badge";
import type { TransactionStatus } from "./transaction-explorer";

export function TransactionStatusMark({
  status,
  presentation = "inline",
}: {
  status: TransactionStatus;
  presentation?: "inline" | "badge";
}) {
  const dot = (
    <span
      aria-hidden="true"
      className={`size-2 shrink-0 rounded-full ${
        status.tone === "success" ? "bg-market-gain"
          : status.tone === "pending" ? "bg-warning"
            : status.tone === "failure" ? "bg-destructive" : "bg-muted-foreground"
      }`}
    />
  );
  if (presentation === "badge") {
    return <Badge variant="secondary" data-status-tone={status.tone}>{dot}{status.label}</Badge>;
  }
  return <span className="inline-flex items-center gap-2" data-status-tone={status.tone}>{dot}{status.label}</span>;
}
