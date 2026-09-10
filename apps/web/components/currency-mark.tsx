"use client";

import { useState } from "react";
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
  return (
    <CurrencyMarkSlot
      key={`${pending ? "pending" : "ready"}:${src ?? "symbol"}`}
      src={src}
      pending={pending}
      glyph={symbol?.trim() || currency?.trim() || ""}
    />
  );
}

function CurrencyMarkSlot({
  src,
  pending,
  glyph,
}: {
  src: string | null;
  pending: boolean;
  glyph: string;
}) {
  const [flagStatus, setFlagStatus] = useState<"loading" | "ready" | "failed">(
    src ? "loading" : "ready",
  );
  const showShimmer = pending || Boolean(src && flagStatus === "loading");
  const showFlag = Boolean(src && flagStatus !== "failed");

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
