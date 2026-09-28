"use client";

import { useCallback, useMemo } from "react";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { browserHomeQueryClient, disabledQueryKey, ownerQueryKey, ownerQueryMeta, useHomeQuery, useHomeQueryClient } from "@/client/query/query-client";
import {
  parseCardEnrollmentResponse,
  parseCardEphemeralKeyResponse,
  parseCardsResponse,
  parseCardWriteResponse,
  type CardEphemeralKeyResponse,
  type CardsResponse,
} from "@/shared/cards/contract";

type FetchAccountResource = AccountWalletClient["fetchAccountResource"];

export type CardCommands = {
  enroll: () => Promise<string>;
  issue: () => Promise<void>;
  setFrozen: (cardId: string, frozen: boolean) => Promise<void>;
  revealKey: (cardId: string, nonce: string) => Promise<CardEphemeralKeyResponse>;
};

export function useCards({ ownerKey, fetchAccountResource }: {
  ownerKey: string | null;
  fetchAccountResource: FetchAccountResource;
}) {
  const queryClient = useHomeQueryClient(browserHomeQueryClient());
  const queryKey = useMemo(() => ownerKey ? ownerQueryKey(ownerKey, "cards") : disabledQueryKey("cards"), [ownerKey]);
  const query = useHomeQuery({
    queryKey,
    enabled: Boolean(ownerKey),
    meta: ownerKey ? ownerQueryMeta(ownerKey, "memory") : undefined,
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }): Promise<CardsResponse> => {
      const response = parseCardsResponse(await fetchAccountResource("/api/cards", { signal }));
      if (!response) throw new Error("Invalid cards response");
      return response;
    },
  });

  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey, exact: true }), [queryClient, queryKey]);

  const commands = useMemo((): CardCommands => ({
    enroll: async () => {
      const response = parseCardEnrollmentResponse(await fetchAccountResource("/api/cards/enrollment", { method: "POST", body: {} }));
      if (!response) throw new Error("Invalid enrollment response");
      return response.kycUrl;
    },
    issue: async () => {
      try {
        const response = parseCardWriteResponse(await fetchAccountResource("/api/cards", { method: "POST", body: {} }));
        if (!response) throw new Error("Invalid card response");
      } finally {
        await refresh();
      }
    },
    setFrozen: async (cardId, frozen) => {
      try {
        const response = parseCardWriteResponse(await fetchAccountResource(
          `/api/cards/${encodeURIComponent(cardId)}/${frozen ? "freeze" : "unfreeze"}`, { method: "POST", body: {} },
        ));
        if (!response || response.card.id !== cardId) throw new Error("Invalid card response");
      } finally {
        await refresh();
      }
    },
    revealKey: async (cardId, nonce) => {
      const response = parseCardEphemeralKeyResponse(await fetchAccountResource(
        `/api/cards/${encodeURIComponent(cardId)}/ephemeral-key`, { method: "POST", body: { nonce } },
      ));
      if (!response || response.cardId !== cardId) throw new Error("Invalid card key response");
      return response;
    },
  }), [fetchAccountResource, refresh]);

  return { query, refresh, commands };
}
