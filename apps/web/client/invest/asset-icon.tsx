import { CurrencyMark } from "@/components/currency-mark";
import type { AssetMarkPresentation } from "@/client/asset-mark/presentation";
import styles from "./asset-icon.module.css";

type AssetIconProps = {
  mark: AssetMarkPresentation;
};

export function AssetIcon({ mark }: AssetIconProps) {
  return (
    <span className={styles.icon} role="img" aria-label={`${mark.name} icon`}>
      <CurrencyMark
        currency={mark.currency}
        src={mark.imageUrl}
        symbol={mark.symbol}
        pending={mark.pending}
      />
    </span>
  );
}
