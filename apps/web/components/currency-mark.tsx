"use client";

import { useLayoutEffect, useRef, useState } from "react";
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

function isNativeEthGlyph(glyph: string): boolean {
  return glyph.toUpperCase() === "ETH";
}

export function CurrencyMark({
  currency,
  symbol,
  src: imageSrc,
  pending = false,
}: CurrencyMarkProps) {
  const image = imageSrc?.trim() || null;
  const flag = pending || image ? null : presentationCurrencyFlag(currency);
  const src = pending ? null : image ?? (flag ? currencyFlagSrc(flag) : null);
  const glyph = symbol?.trim() || currency?.trim() || "";
  const eth = !pending && !src && isNativeEthGlyph(glyph);
  return (
    <CurrencyMarkSlot
      key={`${pending ? "pending" : "ready"}:${src ?? (eth ? "eth" : "symbol")}`}
      src={src}
      pending={pending}
      glyph={glyph}
      resolvedKind={image ? "image" : "flag"}
      eth={eth}
    />
  );
}

function CurrencyMarkSlot({
  src,
  pending,
  glyph,
  resolvedKind,
  eth,
}: {
  src: string | null;
  pending: boolean;
  glyph: string;
  resolvedKind: "flag" | "image";
  eth: boolean;
}) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageStatus, setImageStatus] = useState<"loading" | "ready" | "failed">(
    src ? "loading" : "ready",
  );
  const showShimmer = pending || Boolean(src && imageStatus === "loading");
  const showImage = Boolean(src && imageStatus !== "failed");
  const showEth = eth && !showShimmer;
  const readyKind =
    showImage && imageStatus === "ready"
      ? resolvedKind
      : showEth
        ? "eth"
        : "symbol";

  useLayoutEffect(() => {
    const image = imageRef.current;
    if (!src || !image?.complete || image.naturalWidth === 0) return;
    setImageStatus("ready");
  }, [src]);

  return (
    <span
      className={`${styles.mark} ${showShimmer ? "shimmer" : ""}`}
      data-mark={showShimmer ? "shimmer" : readyKind}
      data-shimmer={showShimmer ? "mark" : undefined}
      aria-hidden="true"
    >
      {showImage && src ? (
        // Token metadata URLs and local flag SVGs are not in the Next allowlist.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imageRef}
          className={styles.flag}
          src={src}
          alt=""
          draggable={false}
          hidden={imageStatus !== "ready"}
          onLoad={() => setImageStatus("ready")}
          onError={() => setImageStatus("failed")}
        />
      ) : null}
      {showEth ? <EthMark /> : null}
      {!showShimmer && !showEth && !(showImage && imageStatus === "ready") ? (
        <span className={styles.fallback}>{glyph}</span>
      ) : null}
    </span>
  );
}

/** Designed ETH diamond on the Ethereum purple disc. Original geometry; not a flag. */
function EthMark() {
  return (
    <svg className={styles.eth} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#627EEA" />
      <path fill="#fff" d="M16 6.55 22.85 16.2 16 19.95 9.15 16.2Z" />
      <path
        fill="#fff"
        fillOpacity="0.7"
        d="M16 21.15 22.85 16.85 16 25.45 9.15 16.85Z"
      />
    </svg>
  );
}
