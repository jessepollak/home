"use client";

import { useState } from "react";
import { formatAddress } from "@/shared/formatting";
import styles from "./address-text.module.css";

export function AddressText({
  address,
  className,
  copiedLabel = "Copied",
}: {
  address: string;
  className?: string;
  copiedLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const condensed = formatAddress(address);

  async function copy() {
    if (!navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      className={`${styles.text}${copied ? ` ${styles.copied}` : ""}${className ? ` ${className}` : ""}`}
      title={address}
      aria-label={copied ? copiedLabel : `Copy ${condensed}`}
      onClick={() => void copy()}
    >
      {copied ? copiedLabel : condensed}
    </button>
  );
}
