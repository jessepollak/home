import { AddressText } from "@/components/address-text";
import { formatPresentationDate } from "@/shared/formatting";

type SavedProvenance = { source: "default" | "stored"; revision: number; updatedAt: string | null; updatedBy: string | null };

export function SavedSettingsLine({ settings, unsaved }: { settings: SavedProvenance; unsaved: string }) {
  if (settings.source === "default" || !settings.updatedAt) return <p role="status" className="text-sm text-muted-foreground">{unsaved}</p>;
  const when = formatPresentationDate(settings.updatedAt, { style: "date-time-zone", timeZone: "UTC" });
  return (
    <p role="status" className="text-sm text-muted-foreground">
      Saved {when}{settings.updatedBy && <> by <AddressText address={settings.updatedBy} /></>}, revision {settings.revision}.
    </p>
  );
}
