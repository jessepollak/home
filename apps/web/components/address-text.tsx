"use client";

import { formatAddress } from "@/shared/formatting";
import { CopyableValue } from "./copyable-value";

export function AddressText({
  address,
  className,
  copiedLabel = "Copied",
  resetKey,
  presentation,
}: {
  address: string;
  className?: string;
  copiedLabel?: string;
  resetKey?: string;
  presentation?: "inline" | "compact";
}) {
  return (
    <CopyableValue
      value={address}
      display={formatAddress(address)}
      copiedLabel={copiedLabel}
      valueKind="address"
      className={className}
      resetKey={resetKey}
      presentation={presentation}
    />
  );
}
