import { Badge } from "@/components/ui/badge";
import { changeLabel, type BoardFrame } from "./manifest";

export function ChangeTag({ change }: { change: BoardFrame["change"] }) {
  if (change === "unchanged") return null;
  return <Badge variant={change === "new" ? "default" : "secondary"}>{changeLabel(change)}</Badge>;
}

export function FrameSize({ width, height, compact = false }: { width: number; height: number; compact?: boolean }) {
  const size = compact ? `${width}×${height}` : `${width} × ${height}`;
  return <Badge variant="outline" title={`Viewport ${width} × ${height} px`}>
    <span aria-hidden="true">{size}</span>
    <span className="sr-only">Viewport {width} × {height} px</span>
  </Badge>;
}
