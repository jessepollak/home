import { Badge } from "@/components/ui/badge";
import type { SupportContextRef } from "@/shared/support/contract";

export function SupportContextChip({ context }: { context: SupportContextRef }) {
  return <Badge variant="outline">{context.kind === "funding_order" ? "About your add money order" : "About your money action"}</Badge>;
}
