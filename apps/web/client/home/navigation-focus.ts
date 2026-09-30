import type { ShellPanelId } from "@/config/navigation";
import type { ShellLocation } from "@/config/shell-location";

export function panelFocusKey(panel: ShellPanelId, location: ShellLocation): string {
  return [
    panel,
    location.shelf ?? "",
    location.asset ?? "",
    location.group ?? "",
    location.market ?? "",
    location.cashView ?? "",
    location.holding ?? "",
  ].join("\u0000");
}
