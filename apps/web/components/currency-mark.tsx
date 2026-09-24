"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  currencyFlagSrc,
  presentationCurrencyFlag,
} from "./currency-flag";
import styles from "./currency-mark.module.css";
import {
  assetKeyForErc20,
  PORTFOLIO_NATIVE_ASSET_KEY,
  PORTFOLIO_USDC_ASSET_KEY,
} from "@/config/portfolio-assets";
import { BASE_CBBTC } from "@/shared/assets/base";

type CurrencyMarkProps = {
  assetKey?: string | null;
  currency?: string | null;
  symbol?: string | null;
  src?: string | null;
  pending?: boolean;
  size?: "default" | "sm";
  presentation?: "default" | "selector";
};

type ResolvedMarkKind = "image" | "flag" | "brand";

const brandMarkFiles: ReadonlyMap<string, string> = new Map([
  [PORTFOLIO_USDC_ASSET_KEY, "usdc"],
  [PORTFOLIO_NATIVE_ASSET_KEY, "eth"],
  [assetKeyForErc20("0x4200000000000000000000000000000000000006"), "eth"],
  [assetKeyForErc20(BASE_CBBTC.address), "btc"],
]);

function assetBrandMarkSrc(assetKey: string | null | undefined): string | null {
  const file = assetKey ? brandMarkFiles.get(assetKey.trim().toLowerCase()) : undefined;
  return file ? `/asset-marks/${file}.svg` : null;
}

export function CurrencyMark({
  assetKey,
  currency,
  symbol,
  src: imageSrc,
  pending = false,
  size = "default",
  presentation = "default",
}: CurrencyMarkProps) {
  const [brokenImage, setBrokenImage] = useState<string | null>(null);
  const requestedImage = imageSrc?.trim() || null;
  const glyph = symbol?.trim() || currency?.trim() || "";
  const brandFallback = assetBrandMarkSrc(assetKey);
  const image = requestedImage && !(brandFallback && brokenImage === requestedImage)
    ? requestedImage
    : null;
  const flag = pending || image ? null : presentationCurrencyFlag(currency);
  const brand = pending || image || flag ? null : brandFallback;
  const src = pending ? null : image ?? (flag ? currencyFlagSrc(flag) : brand);
  const resolvedKind: ResolvedMarkKind = image ? "image" : flag ? "flag" : "brand";
  return (
    <CurrencyMarkSlot
      key={`${pending ? "pending" : "ready"}:${src ?? "symbol"}`}
      src={src}
      pending={pending}
      glyph={glyph}
      resolvedKind={resolvedKind}
      size={size}
      presentation={presentation}
      onImageError={image && brandFallback ? () => setBrokenImage(image) : undefined}
    />
  );
}

export function GlyphMark({
  children,
  size = "default",
}: {
  children: ReactNode;
  size?: "default" | "sm";
}) {
  return (
    <span className={styles.mark} data-mark="glyph" data-size={size} aria-hidden="true">
      <span className={styles.inner} data-mark-inner="">
        <span className={styles.glyph}>{children}</span>
      </span>
    </span>
  );
}

function CurrencyMarkSlot({
  src,
  pending,
  glyph,
  resolvedKind,
  size,
  presentation,
  onImageError,
}: {
  src: string | null;
  pending: boolean;
  glyph: string;
  resolvedKind: ResolvedMarkKind;
  size: "default" | "sm";
  presentation: "default" | "selector";
  onImageError?: () => void;
}) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageStatus, setImageStatus] = useState<"loading" | "ready" | "failed">(
    src ? "loading" : "ready",
  );
  const showShimmer = pending || Boolean(src && imageStatus === "loading");
  const showImage = Boolean(src && imageStatus !== "failed");
  const readyKind = showImage && imageStatus === "ready" ? resolvedKind : "symbol";

  useLayoutEffect(() => {
    const image = imageRef.current;
    if (!src || !image?.complete || image.naturalWidth === 0) return;
    setImageStatus("ready");
  }, [src]);

  return (
    <span
      className={`${styles.mark} ${showShimmer
        ? "animate-pulse motion-reduce:animate-none"
        : ""}`}
      data-mark={showShimmer ? "shimmer" : readyKind}
      data-shimmer={showShimmer ? "mark" : undefined}
      data-size={size}
      data-presentation={presentation}
      aria-hidden="true"
    >
      <span className={styles.inner} data-mark-inner="">
        {showImage && src ? (
          // oxlint-disable-next-line nextjs/no-img-element -- Provider icon URLs are remote runtime data, so next/image cannot statically optimize them.
          <img
            ref={imageRef}
            className={resolvedKind === "flag" ? styles.flag : styles.image}
            src={src}
            alt=""
            referrerPolicy="no-referrer"
            draggable={false}
            hidden={imageStatus !== "ready"}
            onLoad={() => setImageStatus("ready")}
            onError={() => {
              setImageStatus("failed");
              onImageError?.();
            }}
          />
        ) : null}
        {!showShimmer && !(showImage && imageStatus === "ready") ? (
          <span className={styles.fallback}>{glyph}</span>
        ) : null}
      </span>
    </span>
  );
}
