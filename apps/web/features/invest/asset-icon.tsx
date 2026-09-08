"use client";

import { useState } from "react";
import styles from "./asset-icon.module.css";

type AssetIconProps = {
  assetId: string;
  label: string;
  initials?: string;
  imageUrl?: string;
  size?: "sm" | "md";
};

export function AssetIcon({
  assetId,
  label,
  initials,
  imageUrl,
  size = "sm",
}: AssetIconProps) {
  const [failed, setFailed] = useState(false);
  const mark = (initials ?? assetId).slice(0, 2).toUpperCase() || "?";
  const showImage = Boolean(imageUrl) && !failed;

  return (
    <span
      className={`${styles.icon} ${styles[size]}`}
      role="img"
      aria-label={`${label} icon`}
    >
      {showImage ? (
        // External token metadata URLs are not in the Next image allowlist.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className={styles.fallback} aria-hidden="true">
          {mark}
        </span>
      )}
    </span>
  );
}
