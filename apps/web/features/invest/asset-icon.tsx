import { CurrencyMark } from "@/components/currency-mark";
import styles from "./asset-icon.module.css";

type AssetIconProps = {
  assetId: string;
  label: string;
  initials?: string;
  imageUrl?: string;
  pending?: boolean;
};

export function AssetIcon({
  assetId,
  label,
  initials,
  imageUrl,
  pending = false,
}: AssetIconProps) {
  return (
    <span className={styles.icon} role="img" aria-label={`${label} icon`}>
      <CurrencyMark
        src={imageUrl}
        symbol={initials ?? assetId}
        pending={pending && !imageUrl}
      />
    </span>
  );
}
