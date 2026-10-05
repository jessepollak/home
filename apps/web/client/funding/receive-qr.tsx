"use client";

import { useMemo } from "react";
import { encode } from "uqr";

export const RECEIVE_QR_DISPLAY_PX = 220;

export function ReceiveQr({ value, label }: { value: string; label: string }) {
  const qr = useMemo(() => encode(value, { ecc: "M", border: 1 }), [value]);
  const path = useMemo(() => modulesToPath(qr.data), [qr.data]);

  return (
    <svg
      className="block size-full"
      data-receive-qr=""
      width={RECEIVE_QR_DISPLAY_PX}
      height={RECEIVE_QR_DISPLAY_PX}
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={label}
    >
      <rect
        width={qr.size}
        height={qr.size}
        className="fill-primary-foreground"
      />
      <path d={path} className="fill-primary" />
    </svg>
  );
}

function modulesToPath(data: boolean[][]): string {
  const parts: string[] = [];
  for (let y = 0; y < data.length; y += 1) {
    const row = data[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x += 1) {
      if (row[x]) parts.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  return parts.join("");
}
