"use client";

import { useEffect, useState } from "react";
import {
  currencyFlagSrc,
  presentationCurrencyFlag,
} from "./currency-flag";
import styles from "./currency-mark.module.css";

type CurrencyMarkProps = {
  currency?: string | null;
  symbol?: string | null;
  pending?: boolean;
};

export function CurrencyMark({
  currency,
  symbol,
  pending = false,
}: CurrencyMarkProps) {
  const flag = pending ? null : presentationCurrencyFlag(currency);
  const src = flag ? currencyFlagSrc(flag) : null;
  const [flagStatus, setFlagStatus] = useState<"loading" | "ready" | "failed">(
    src ? "loading" : "ready",
  );

  useEffect(() => {
    setFlagStatus(src ? "loading" : "ready");
  }, [src]);

  const showShimmer = pending || Boolean(src && flagStatus === "loading");
  const showFlag = Boolean(src && flagStatus !== "failed");
  const glyph = (symbol?.trim() || currency?.trim() || "");

  return (
    <span
      className={`${styles.mark} ${showShimmer ? "shimmer" : ""}`}
      data-mark={
        showShimmer ? "shimmer" : showFlag && flagStatus === "ready" ? "flag" : "symbol"
      }
      data-shimmer={showShimmer ? "mark" : undefined}
      aria-hidden="true"
    >
      {showFlag && src ? (
        // Local static SVGs; not in the remote Next image allowlist.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={styles.flag}
          src={src}
          alt=""
          draggable={false}
          hidden={flagStatus !== "ready"}
          onLoad={() => setFlagStatus("ready")}
          onError={() => setFlagStatus("failed")}
        />
      ) : null}
      {!showShimmer && !(showFlag && flagStatus === "ready") ? (
        <span className={styles.fallback}>{glyph}</span>
      ) : null}
    </span>
  );
}
