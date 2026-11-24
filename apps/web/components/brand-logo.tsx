"use client";

import Image from "next/image";
import { useCallback, useState, type ReactNode } from "react";

export function useBrandLogoImage(src: string | null) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const ref = useCallback((image: HTMLImageElement | null) => {
    if (image && image.complete && image.naturalWidth === 0) setFailedSrc(image.getAttribute("src"));
  }, []);
  const onError = useCallback(() => setFailedSrc(src), [src]);
  return { shown: src !== null && failedSrc !== src, imageProps: { ref, onError } };
}

export function BrandLogoImage({ src, alt, className, imageProps }: {
  src: string; alt: string; className?: string; imageProps: ReturnType<typeof useBrandLogoImage>["imageProps"];
}) {
  return (
    <Image
      {...imageProps}
      unoptimized
      loading="eager"
      width={64}
      height={64}
      className={className}
      style={{ width: "auto" }}
      src={src}
      alt={alt}
      draggable={false}
      referrerPolicy="no-referrer"
    />
  );
}

export function BrandLogo({ src, alt, className, fallback }: { src: string | null; alt: string; className?: string; fallback: ReactNode }) {
  const { shown, imageProps } = useBrandLogoImage(src);
  if (!shown || src === null) return fallback;
  return <BrandLogoImage src={src} alt={alt} className={className} imageProps={imageProps} />;
}
