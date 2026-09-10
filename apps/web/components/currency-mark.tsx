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
  /** Resolved asset image. Wins over a cash flag. Not a shipped SVG mark. */
  src?: string | null;
  pending?: boolean;
};

export function CurrencyMark({
  currency,
  symbol,
  src: imageSrc,
  pending = false,
}: CurrencyMarkProps) {
  const image = imageSrc?.trim() || null;
  const flag = pending || image ? null : presentationCurrencyFlag(currency);
  const src = pending ? null : image ?? (flag ? currencyFlagSrc(flag) : null);
  return (
    <CurrencyMarkSlot
      key={`${pending ? "pending" : "ready"}:${src ?? "symbol"}`}
      src={src}
      pending={pending}
      glyph={symbol?.trim() || currency?.trim() || ""}
      resolvedKind={image ? "image" : "flag"}
    />
  );
}

function CurrencyMarkSlot({
  src,
  pending,
  glyph,
  resolvedKind,
}: {
  src: string | null;
  pending: boolean;
  glyph: string;
  resolvedKind: "flag" | "image";
}) {
  const [imageStatus, setImageStatus] = useState<"loading" | "ready" | "failed">(
    src ? "loading" : "ready",
  );
  const showShimmer = pending || Boolean(src && imageStatus === "loading");
  const showImage = Boolean(src && imageStatus !== "failed");

  return (
    <span
      className={`${styles.mark} ${showShimmer ? "shimmer" : ""}`}
      data-mark={
        showShimmer
          ? "shimmer"
          : showImage && imageStatus === "ready"
            ? resolvedKind
            : "symbol"
      }
      data-shimmer={showShimmer ? "mark" : undefined}
      aria-hidden="true"
    >
      {showImage && src ? (
        // Token metadata URLs and local flag SVGs are not in the Next allowlist.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={styles.flag}
          src={src}
          alt=""
          draggable={false}
          hidden={imageStatus !== "ready"}
          onLoad={() => setImageStatus("ready")}
          onError={() => setImageStatus("failed")}
        />
      ) : null}
      {!showShimmer && !(showImage && imageStatus === "ready") ? (
        <span className={styles.fallback}>{glyph}</span>
      ) : null}
    </span>
  );
}
