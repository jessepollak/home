import { CurrencyMark } from "@/components/currency-mark";
import type { AssetMarkPresentation } from "@/client/asset-mark/presentation";

type AssetIconProps = {
  mark: AssetMarkPresentation;
};

export function AssetIcon({ mark }: AssetIconProps) {
  return (
    <span className="inline-grid size-8 flex-none place-items-center" role="img" aria-label={`${mark.name} icon`}>
      <CurrencyMark
        assetKey={mark.assetKey}
        currency={mark.currency}
        src={mark.imageUrl}
        symbol={mark.symbol}
        pending={mark.pending}
        size="sm"
      />
    </span>
  );
}
