"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { parseAccountDeletionReceipt, type AccountDeletionReceipt } from "@/shared/account/contracts/account-deletion";
import { clearAccountDeletionDevice, type DeviceDeletionRow } from "./account-deletion-device";
import type { OwnerGenerationFence } from "./owner-generation-fence";

export const AccountDeletionCompletionContext = createContext<(receipt: AccountDeletionReceipt) => void>(() => {});
export function useAccountDeletionCompletion() { return useContext(AccountDeletionCompletionContext); }

type Recovery = { ownerKey: string | null; receipt: AccountDeletionReceipt | null; deviceRows: DeviceDeletionRow[]; busy: boolean; error: string | null };

export function useAccountDeletionRecovery({ ownerKey, ownerFence, queryClient, signOut }: { ownerKey: string | null; ownerFence: OwnerGenerationFence; queryClient: QueryClient; signOut: () => Promise<void> }) {
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const active = useRef<{ ownerKey: string; generation: number; expectsOwnerDisappearance: boolean } | null>(null);
  const mounted = useRef(false);
  const retryWork = useRef<(() => void) | undefined>(undefined);
  const retry = useCallback(() => retryWork.current?.(), []);
  const currentOwner = useRef(ownerKey);
  useLayoutEffect(() => {
    mounted.current = true;
    const previousOwner = currentOwner.current;
    currentOwner.current = ownerKey;
    const operation = active.current;
    if (operation?.expectsOwnerDisappearance && previousOwner === operation.ownerKey && ownerKey === null &&
      ownerFence.capture() === operation.generation + 1) {
      operation.generation = ownerFence.capture();
      operation.expectsOwnerDisappearance = false;
    } else if (operation && ownerKey !== previousOwner) {
      active.current = null;
      retryWork.current = undefined;
    }
    return () => { mounted.current = false; };
  }, [ownerFence, ownerKey]);
  if (ownerKey && recovery && ownerKey !== recovery.ownerKey) setRecovery(null);

  const run = useCallback(async (recover: () => Promise<unknown>, completedReceipt?: AccountDeletionReceipt, isOriginCurrent: () => boolean = () => true) => {
    if (!mounted.current || !ownerKey || currentOwner.current !== ownerKey || !isOriginCurrent()) return;
    if (active.current && ownerFence.isCurrent(active.current.generation)) return;
    const operation = { ownerKey, generation: ownerFence.capture(), expectsOwnerDisappearance: false };
    active.current = operation;
    retryWork.current = undefined;
    const isCurrent = () => mounted.current && active.current === operation &&
      (!currentOwner.current || currentOwner.current === ownerKey) && ownerFence.isCurrent(operation.generation);
    if (!isCurrent()) return;
    let receipt = completedReceipt ?? null;
    let deviceRows: DeviceDeletionRow[] = [];
    setRecovery({ ownerKey, receipt, deviceRows, busy: true, error: null });
    let busy = false;
    const attempt = async () => {
      if (busy || !isCurrent()) return;
      busy = true;
      retryWork.current = undefined;
      setRecovery({ ownerKey, receipt, deviceRows, busy: true, error: null });
      let error: string | null = null;
      if (!deviceRows.length || deviceRows.some((row) => !row.cleared)) {
        deviceRows = await clearAccountDeletionDevice(queryClient, isCurrent);
      }
      if (!isCurrent()) return;
      const deviceError = deviceRows.some((row) => !row.cleared)
        ? "We couldn't confirm that all Home data was cleared from this device. Try again."
        : null;
      setRecovery({ ownerKey, receipt, deviceRows, busy: true, error: deviceError });
      if (!receipt) {
        try {
          const candidate = parseAccountDeletionReceipt(await recover());
          if (!candidate || candidate.status !== "completed") throw new Error("Receipt unavailable");
          receipt = candidate;
        } catch {
          error = "Your session was revoked, but we couldn't recover a completed deletion receipt. Deletion is not confirmed here.";
        }
      }
      if (!isCurrent()) return;
      if (receipt) {
        setRecovery({ ownerKey, receipt, deviceRows, busy: true, error: deviceError });
        try {
          operation.expectsOwnerDisappearance = true;
          const pendingSignOut = signOut();
          operation.generation = ownerFence.capture();
          await pendingSignOut;
        } catch {
          error = "Your Home account was deleted, but sign-out did not finish on this device.";
        }
      }
      if (!isCurrent()) return;
      error = [error, deviceError].filter(Boolean).join(" ") || null;
      busy = false;
      setRecovery({ ownerKey, receipt, deviceRows, busy: false, error });
      retryWork.current = error ? () => { void attempt(); } : undefined;
    };
    await attempt();
  }, [ownerFence, ownerKey, queryClient, signOut]);
  const complete = useCallback((receipt: AccountDeletionReceipt) => { void run(async () => receipt, receipt); }, [run]);
  const revoked = useCallback((recover: () => Promise<unknown>, isOriginCurrent?: () => boolean) => { void run(recover, undefined, isOriginCurrent); }, [run]);
  return { recovery, complete, revoked, retry };
}
