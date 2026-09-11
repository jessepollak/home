"use client";

import { formatAddress } from "@/shared/formatting";
import { CopyableValue } from "./copyable-value";

/**
 * Address-specific convenience over the shared {@link CopyableValue} primitive.
 */
export function AddressText({
  address,
  className,
  copiedLabel = "Copied",
  resetKey,
}: {
  address: string;
  className?: string;
  copiedLabel?: string;
  resetKey?: string;
}) {
  return (
    <CopyableValue
      value={address}
      display={formatAddress(address)}
      copiedLabel={copiedLabel}
      valueKind="address"
      className={className}
      resetKey={resetKey}
    />
  );
}
