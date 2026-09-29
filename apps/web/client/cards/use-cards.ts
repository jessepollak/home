"use client";

import { useCallback, useEffect, useMemo } from "react";
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

export class CardRefreshError extends Error {
  override name = "CardRefreshError";
  constructor(options?: ErrorOptions) {
    super("Card state could not be re-read after a write", options);
  }
}

type ConfirmRead = (response: CardsResponse) => boolean;

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
  useEffect(() => {
    if (!ownerKey) return;
    const url = new URL(window.location.href);
    if (url.pathname !== "/card" || url.searchParams.get("return") !== "verification") return;
    url.searchParams.delete("return");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    void refresh();
  }, [ownerKey, refresh]);
  const reread = useCallback(async (): Promise<CardsResponse> => {
    const before = queryClient.getQueryState(queryKey)?.dataUpdateCount ?? 0;
    await queryClient.refetchQueries({ queryKey, exact: true }, { throwOnError: true });
    const state = queryClient.getQueryState<CardsResponse>(queryKey);
    if (!state || state.fetchStatus !== "idle" || state.status !== "success" || state.dataUpdateCount <= before || !state.data) {
      throw new Error("Card re-read did not complete");
    }
    return state.data;
  }, [queryClient, queryKey]);
  const confirmedWrite = useCallback(async (write: () => Promise<void>, confirms: ConfirmRead) => {
    const written = await write().then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    if (!written.ok) {
      const read = await reread().then(
        (data) => ({ ok: true as const, data }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      if (read.ok && read.data.state !== "unavailable" && confirms(read.data)) return;
      throw written.error;
    }
    let response: CardsResponse;
    try {
      response = await reread();
    } catch (error) {
      throw new CardRefreshError({ cause: error });
    }
    if (response.state === "unavailable" || !confirms(response)) throw new CardRefreshError();
  }, [reread]);

  const commands = useMemo((): CardCommands => ({
    enroll: async () => {
      const response = parseCardEnrollmentResponse(await fetchAccountResource("/api/cards/enrollment", { method: "POST", body: {} }));
      if (!response) throw new Error("Invalid enrollment response");
      return response.kycUrl;
    },
    issue: () => {
      let issuedId: string | null = null;
      return confirmedWrite(async () => {
        const response = parseCardWriteResponse(await fetchAccountResource("/api/cards", { method: "POST", body: {} }));
        if (!response) throw new Error("Invalid card response");
        issuedId = response.card.id;
      }, (read) => read.cards.some((card) => card.id === issuedId && card.status !== "canceled"));
    },
    setFrozen: (cardId, frozen) => confirmedWrite(async () => {
      const response = parseCardWriteResponse(await fetchAccountResource(
        frozen ? `/api/cards/${encodeURIComponent(cardId)}/freeze` : `/api/cards/${encodeURIComponent(cardId)}/unfreeze`, { method: "POST", body: {} },
      ));
      if (!response || response.card.id !== cardId) throw new Error("Invalid card response");
    }, (read) => read.cards.find((card) => card.id === cardId)?.status === (frozen ? "frozen" : "active")),
    revealKey: async (cardId, nonce) => {
      const response = parseCardEphemeralKeyResponse(await fetchAccountResource(
        `/api/cards/${encodeURIComponent(cardId)}/ephemeral-key`, { method: "POST", body: { nonce } },
      ));
      if (!response || response.cardId !== cardId) throw new Error("Invalid card key response");
      return response;
    },
  }), [confirmedWrite, fetchAccountResource]);

  return { query, refresh, commands };
}
