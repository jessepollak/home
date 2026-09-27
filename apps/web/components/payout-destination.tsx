import { cashPayeeLabels } from "@/shared/funding/cash-payee";
import { payoutMark } from "@/components/payout-method-marks";
import { PayoutMark } from "@/components/ui/payout-mark";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";

export function PayoutDestination({ platform, label, destination, onEdit }: {
  platform: string;
  label: string;
  destination: string;
  onEdit: () => void;
}) {
  const labels = cashPayeeLabels(platform, label);
  const mark = payoutMark(platform, label);
  return <Item variant="muted" role="group" aria-label="Payout destination" className="min-w-0">
    <ItemMedia><PayoutMark variant={mark.variant}>{mark.text}</PayoutMark></ItemMedia>
    <ItemContent className="min-w-0">
      <ItemDescription lines="wrap">{label} · {labels.noun}</ItemDescription>
      <ItemTitle truncate="wrap" className="min-w-0"><bdi dir="ltr">{destination}</bdi></ItemTitle>
    </ItemContent>
    <ItemActions><Button variant="outline" size="sm-touch" aria-label={`Edit ${labels.field}`} onClick={onEdit}>Edit</Button></ItemActions>
  </Item>;
}
