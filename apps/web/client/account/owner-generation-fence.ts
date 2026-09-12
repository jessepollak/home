"use client";

import { useCallback, useMemo, useRef } from "react";
import { TransferExecutionError } from "@/shared/transfers/types";

export type OwnerGenerationIdentity = number;
export type OwnerGenerationFence = {
  advance: (preserveOwnerKey?: string | null) => number;
  capture: () => number;
  isCurrent: (identity: number) => boolean;
  assertCurrent: (identity: number) => void;
  updateAuthorizationBoundary: (
    boundary: string | null,
    persistedOwnerKey: string | null,
  ) => void;
  updateOwnerKey: (ownerKey: string | null) => void;
};

export function useOwnerGenerationFence(
  onAdvance: (preserveOwnerKey?: string | null) => void,
): OwnerGenerationFence {
  const generationRef = useRef(0);
  const boundaryRef = useRef<string | null>(null);
  const advance = useCallback((preserveOwnerKey?: string | null) => {
    generationRef.current += 1;
    onAdvance(preserveOwnerKey);
    return generationRef.current;
  }, [onAdvance]);
  const updateAuthorizationBoundary = useCallback((
    boundary: string | null,
    persistedOwnerKey: string | null,
  ) => {
    if (boundaryRef.current === boundary) return;
    const preserveVerifiedOwner = boundaryRef.current === null && boundary !== null
      ? persistedOwnerKey
      : undefined;
    boundaryRef.current = boundary;
    generationRef.current += 1;
    onAdvance(preserveVerifiedOwner);
  }, [onAdvance]);
  const capture = useCallback(() => generationRef.current, []);
  const isCurrent = useCallback((identity: number) => identity === generationRef.current, []);
  const assertCurrent = useCallback((identity: number) => {
    if (identity !== generationRef.current) {
      throw new TransferExecutionError("stale-session");
    }
  }, []);
  const updateOwnerKey = useCallback(() => {}, []);

  return useMemo(() => ({
    advance,
    capture,
    isCurrent,
    assertCurrent,
    updateAuthorizationBoundary,
    updateOwnerKey,
  }), [advance, assertCurrent, capture, isCurrent, updateAuthorizationBoundary, updateOwnerKey]);
}
