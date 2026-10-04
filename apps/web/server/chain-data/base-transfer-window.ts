import "server-only";

import { createHash } from "node:crypto";
import { isRecord } from "@/shared/guards";
import { ChainDataError } from "./errors";

export const BASE_TRANSFER_SCAN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CURSOR_LENGTH = 4096;

type WindowScope = {
  walletAddress: string;
  assets: readonly { address: string }[];
  includeUnknownAssets: boolean;
  from: string;
  to: string;
};

type ScanPosition = { to: string; rowCursor: string | null; legacyCursor: string | null };

function scopeKey(scope: WindowScope): string {
  return createHash("sha256").update(JSON.stringify([
    scope.walletAddress, scope.includeUnknownAssets,
    scope.assets.map((asset) => asset.address).sort(), scope.from, scope.to,
  ])).digest("hex");
}

export function transferScanPosition(scope: WindowScope, cursor: string | null): ScanPosition {
  if (cursor === null) return { to: scope.to, rowCursor: null, legacyCursor: null };
  if (cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH) {
    throw new ChainDataError("invalid-input", "Invalid transfer cursor.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch (cause) {
    throw new ChainDataError("invalid-input", "Invalid transfer cursor.", { cause });
  }
  if (!isRecord(parsed) || !("scanVersion" in parsed)) {
    return { to: scope.to, rowCursor: null, legacyCursor: cursor };
  }
  const { scanTo, rowCursor, legacyCursor } = parsed;
  const scanTimestamp = typeof scanTo === "string" ? Date.parse(scanTo) : NaN;
  const remaining = Date.parse(scope.to) - scanTimestamp;
  if (parsed.scanVersion !== 1 || parsed.scope !== scopeKey(scope) || typeof scanTo !== "string" ||
    !Number.isFinite(scanTimestamp) || scanTimestamp <= Date.parse(scope.from) ||
    remaining < 0 ||
    new Date(scanTimestamp).toISOString() !== scanTo ||
    !(rowCursor === null || typeof rowCursor === "string" &&
      rowCursor.length > 0 && rowCursor.length <= MAX_CURSOR_LENGTH) ||
    !(legacyCursor === null || typeof legacyCursor === "string" &&
      legacyCursor.length > 0 && legacyCursor.length <= MAX_CURSOR_LENGTH)) {
    throw new ChainDataError("invalid-input", "Invalid transfer window cursor.");
  }
  return { to: scanTo, rowCursor, legacyCursor };
}

export function transferScanBounds(scope: WindowScope, position: ScanPosition): { from: string; to: string } {
  return {
    from: new Date(Math.max(Date.parse(scope.from), Date.parse(position.to) - BASE_TRANSFER_SCAN_WINDOW_MS)).toISOString(),
    to: position.to,
  };
}

export function nextTransferScanCursor(
  scope: WindowScope,
  bounds: { from: string; to: string },
  rowCursor: string | null,
  legacyCursor: string | null,
  narrowed = false,
  previousRowCursor: string | null = null,
): string | null {
  if (!narrowed && Date.parse(scope.to) - Date.parse(scope.from) <= BASE_TRANSFER_SCAN_WINDOW_MS) return rowCursor;
  if (rowCursor === null && bounds.from === scope.from) return null;
  const encoded = Buffer.from(JSON.stringify({
    scanVersion: 1,
    scope: scopeKey(scope),
    scanTo: rowCursor === null ? bounds.from : bounds.to,
    rowCursor: rowCursor ?? (narrowed ? previousRowCursor : null),
    legacyCursor,
  }), "utf8").toString("base64url");
  if (encoded.length > MAX_CURSOR_LENGTH) {
    throw new ChainDataError("invalid-input", "Invalid transfer window cursor.");
  }
  return encoded;
}
