"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  AccountWalletClientProvider,
  createBlockedAccountWalletClient,
  type AccountWalletClient,
} from "@/features/account/cdp-client";
import type { RegionId } from "@/config/regions";
import {
  SAVE_QA_CLOCK_MS,
  createSaveQaPortfolio,
  createSaveQaPositions,
  createSaveQaPreparedAction,
  createSaveQaValuation,
  failClosed,
  newSaveQaCounters,
  saveQaAddress,
  saveQaSubject,
  type SaveQaCounters,
  type SaveQaOwner,
  type SaveQaPositionVariant,
  type SaveQaVaultVariant,
} from "./fixtures";

type PendingPositionRead = {
  id: number;
  owner: SaveQaOwner;
  generation: number;
  signal?: AbortSignal;
  settled: boolean;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  promise: Promise<unknown>;
};

export type SaveQaSnapshot = {
  armed: boolean;
  owner: SaveQaOwner;
  transportGeneration: number;
  positionVariant: SaveQaPositionVariant;
  vaultVariant: SaveQaVaultVariant;
  counters: SaveQaCounters;
  pendingPositionReads: Array<{
    id: number;
    owner: SaveQaOwner;
    generation: number;
    aborted: boolean;
    settled: boolean;
  }>;
};

export type SaveQaController = {
  arm: (options?: {
    owner?: SaveQaOwner;
    positionVariant?: SaveQaPositionVariant;
    vaultVariant?: SaveQaVaultVariant;
  }) => void;
  disarm: () => void;
  setOwner: (owner: SaveQaOwner) => void;
  refresh: (variant?: SaveQaPositionVariant) => void;
  resolveNextPosition: (variant?: SaveQaPositionVariant, owner?: SaveQaOwner) => number;
  rejectNextPosition: (message?: string, owner?: SaveQaOwner) => number;
  snapshot: () => SaveQaSnapshot;
  forceFailClosed: (
    method: "check" | "execute" | "send" | "sign-in" | "sign",
  ) => Promise<never>;
};

declare global {
  interface Window {
    saveQa?: SaveQaController;
  }
}

class SaveQaRuntime {
  counters = newSaveQaCounters();
  pendingPositionReads: PendingPositionRead[] = [];
  private nextRequestId = 1;

  record(counter: keyof SaveQaCounters): void {
    this.counters[counter] += 1;
  }

  requestPositions(owner: SaveQaOwner, generation: number, signal?: AbortSignal): Promise<unknown> {
    this.record("positionReads");
    let resolve!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<unknown>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    this.pendingPositionReads.push({
      id: this.nextRequestId++,
      owner,
      generation,
      signal,
      settled: false,
      resolve,
      reject,
      promise,
    });
    return promise;
  }

  private nextControllable(owner: SaveQaOwner): PendingPositionRead | undefined {
    const active = this.pendingPositionReads.find((candidate) =>
      !candidate.settled && candidate.owner === owner && !candidate.signal?.aborted,
    );
    if (active) return active;
    return this.pendingPositionReads.findLast((candidate) =>
      !candidate.settled && candidate.owner === owner,
    );
  }

  resolveNext(owner: SaveQaOwner, variant: SaveQaPositionVariant): number {
    const request = this.nextControllable(owner);
    if (!request) throw new Error(`No pending Save QA position read for owner ${owner}.`);
    request.settled = true;
    request.resolve(createSaveQaPositions(request.owner, variant, SAVE_QA_CLOCK_MS));
    return request.id;
  }

  rejectNext(owner: SaveQaOwner, message: string): number {
    const request = this.nextControllable(owner);
    if (!request) throw new Error(`No pending Save QA position read for owner ${owner}.`);
    request.settled = true;
    request.reject(new Error(message));
    return request.id;
  }

  snapshot(
    armed: boolean,
    owner: SaveQaOwner,
    transportGeneration: number,
    positionVariant: SaveQaPositionVariant,
    vaultVariant: SaveQaVaultVariant,
  ): SaveQaSnapshot {
    return {
      armed,
      owner,
      transportGeneration,
      positionVariant,
      vaultVariant,
      counters: { ...this.counters },
      pendingPositionReads: this.pendingPositionReads.map((request) => ({
        id: request.id,
        owner: request.owner,
        generation: request.generation,
        aborted: request.signal?.aborted ?? false,
        settled: request.settled,
      })),
    };
  }
}

export function SaveQaClient({ children }: { children: ReactNode }) {
  const [runtime] = useState(() => new SaveQaRuntime());
  const [armed, setArmed] = useState(false);
  const [owner, setOwner] = useState<SaveQaOwner>("a");
  const [transportGeneration, setTransportGeneration] = useState(0);
  const [positionVariant, setPositionVariant] = useState<SaveQaPositionVariant>("weighted");
  const [vaultVariant, setVaultVariant] = useState<SaveQaVaultVariant>("standard");

  const fetchSavingsPositions = useCallback(
    (signal?: AbortSignal) => runtime.requestPositions(owner, transportGeneration, signal),
    [owner, runtime, transportGeneration],
  );

  const client = useMemo<AccountWalletClient>(() => {
    const blocked = createBlockedAccountWalletClient("unconfigured");
    const address = saveQaAddress(owner);
    return {
      ...blocked,
      projectConfigured: true,
      signInAvailability: "ready",
      baseAccountEnabled: false,
      isSignedIn: true,
      ownerKey: `save-qa-owner-${owner}`,
      status: "verified",
      session: {
        user: { subject: saveQaSubject(owner) },
        smartAccount: { address, chainId: 8453 },
        accountProvider: "cdp-embedded",
      },
      message: null,
      requestEmailCode: async () => {
        runtime.record("signIns");
        return failClosed("requestEmailCode");
      },
      verifyEmailCode: async () => {
        runtime.record("signIns");
        return failClosed("verifyEmailCode");
      },
      signInWithBaseAccount: async () => {
        runtime.record("signIns");
        return failClosed("signInWithBaseAccount");
      },
      fetchPortfolio: async () => {
        runtime.record("portfolioReads");
        return createSaveQaPortfolio(owner);
      },
      fetchPortfolioValuation: async (region: RegionId) => {
        runtime.record("valuationReads");
        return createSaveQaValuation(owner, region);
      },
      fetchActivity: async () => ({ items: [], nextCursor: null }),
      fetchOperations: async () => ({ operations: [] }),
      fetchSavingsPositions,
      fetchAccountResource: async () => {
        runtime.record("accountResourceReads");
        return failClosed("fetchAccountResource");
      },
      prepareMoneyAction: async (endpoint, input) => {
        runtime.record("preparations");
        return createSaveQaPreparedAction(owner, endpoint, input);
      },
      checkMoneyAction: async () => {
        runtime.record("checks");
        return failClosed("checkMoneyAction");
      },
      executeMoneyAction: async () => {
        runtime.record("executions");
        return failClosed("executeMoneyAction");
      },
      sendTransfer: async () => {
        runtime.record("sends");
        return failClosed("sendTransfer");
      },
      checkPendingTransfer: async () => {
        runtime.record("sends");
        return failClosed("checkPendingTransfer");
      },
      signTypedData: async () => {
        runtime.record("signatures");
        return failClosed("signTypedData");
      },
      signOut: async () => failClosed("signOut"),
    };
  }, [fetchSavingsPositions, owner, runtime]);

  const controller = useMemo<SaveQaController>(() => ({
    arm: (options = {}) => {
      setOwner(options.owner ?? "a");
      setPositionVariant(options.positionVariant ?? "weighted");
      setVaultVariant(options.vaultVariant ?? "standard");
      setArmed(true);
    },
    disarm: () => setArmed(false),
    setOwner,
    refresh: (variant = positionVariant) => {
      setPositionVariant(variant);
      setTransportGeneration((generation) => generation + 1);
    },
    resolveNextPosition: (variant = positionVariant, requestedOwner = owner) =>
      runtime.resolveNext(requestedOwner, variant),
    rejectNextPosition: (message = "QA transport rejected the position read.", requestedOwner = owner) =>
      runtime.rejectNext(requestedOwner, message),
    snapshot: () => runtime.snapshot(
      armed,
      owner,
      transportGeneration,
      positionVariant,
      vaultVariant,
    ),
    forceFailClosed: async (method) => {
      if (method === "check") return client.checkMoneyAction({} as never) as Promise<never>;
      if (method === "execute") return client.executeMoneyAction({} as never) as Promise<never>;
      if (method === "send") return client.sendTransfer({} as never, "qa") as Promise<never>;
      if (method === "sign-in") return client.requestEmailCode("qa@example.invalid") as Promise<never>;
      return client.signTypedData({}) as Promise<never>;
    },
  }), [armed, client, owner, positionVariant, runtime, transportGeneration, vaultVariant]);

  const installController = useCallback((node: HTMLElement | null) => {
    if (node) {
      window.saveQa = controller;
      window.dispatchEvent(new Event("save-qa-ready"));
    } else if (window.saveQa === controller) {
      delete window.saveQa;
    }
  }, [controller]);

  return (
    <>
      <aside
        ref={installController}
        data-save-qa-disclosure
        aria-label="QA fixture disclosure"
        style={{
          position: "fixed",
          top: 8,
          left: 8,
          zIndex: 10000,
          padding: "4px 7px",
          border: "1px solid currentColor",
          borderRadius: 4,
          background: "Canvas",
          color: "CanvasText",
          font: "600 11px/1.2 system-ui, sans-serif",
        }}
      >
        QA fixture · synthetic account/data · execution disabled
      </aside>
      {armed ? (
        <AccountWalletClientProvider client={client}>
          {children}
        </AccountWalletClientProvider>
      ) : (
        <main aria-label="Save QA disarmed" style={{ padding: 24 }}>
          Save QA is disarmed. A controlled runner must arm a scenario.
        </main>
      )}
    </>
  );
}
