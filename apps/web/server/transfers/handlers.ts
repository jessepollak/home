import "server-only";

import type { MoneyActionOwner } from "@/shared/money-actions/types";
import {
  RECENT_TRANSFER_RECIPIENT_LIMIT,
  TRANSFER_RECIPIENTS_VERSION,
  type RecentTransferRecipientsResponse,
  type TransferRecipientNameResponse,
} from "@/shared/transfers/contracts/recipients";
import {
  normalizeResolvedRecipientAddress,
  normalizeTransferRecipientName,
} from "@/shared/transfers/recipient-name";
import { recentSendRecipientAddresses } from "@/shared/transfers/recent-recipients";
import { getActionsStore, type ActionRow, type ActionsStore } from "@/server/actions/store";
import { authorizeSession, type SessionAuthorizer } from "@/server/auth/authorize";
import { privateError, privateJson } from "@/server/http/private-response";
import { moneyActionOwner } from "@/server/money-actions/session";
import {
  resolveTransferRecipientLabelsCached,
  resolveTransferRecipientNameCached,
  type TransferRecipientLabelResolver,
  type TransferRecipientNameResolver,
} from "./recipient-resolver";

export function createTransferRecipientNameHandler(dependencies: {
  authorize: SessionAuthorizer;
  resolve?: TransferRecipientNameResolver;
}) {
  return async function GET(request: Request): Promise<Response> {
    const session = await authorizeSession(request, dependencies.authorize);
    if (session instanceof Response) return session;
    const name = normalizeTransferRecipientName(new URL(request.url).searchParams.get("name"));
    if (!name) {
      return privateError("RECIPIENT_NAME_INVALID", "Enter a Basename or ENS name ending in .eth.", 400);
    }
    const resolve = dependencies.resolve ?? resolveTransferRecipientNameCached;
    const address = normalizeResolvedRecipientAddress(await resolve(name, { signal: request.signal }));
    if (!address) {
      return privateError("RECIPIENT_NAME_UNRESOLVED", "That name does not resolve to an address.", 404);
    }
    return privateJson({
      version: TRANSFER_RECIPIENTS_VERSION,
      name,
      address,
    } satisfies TransferRecipientNameResponse, 200);
  };
}

export function createRecentTransferRecipientsHandler(dependencies: {
  authorize: SessionAuthorizer;
  store?: Pick<ActionsStore, "listDispatchedSends">;
  resolveLabels?: TransferRecipientLabelResolver;
}) {
  return async function GET(request: Request): Promise<Response> {
    const session = await authorizeSession(request, dependencies.authorize);
    if (session instanceof Response) return session;
    const owner = moneyActionOwner(session);
    const addresses = recentSendRecipientAddresses(
      owner ? await readRecentRows(dependencies, owner) : [],
      RECENT_TRANSFER_RECIPIENT_LIMIT,
    );
    const resolveLabels = dependencies.resolveLabels ?? resolveTransferRecipientLabelsCached;
    const labels = addresses.length === 0
      ? new Map<`0x${string}`, string>()
      : await resolveLabels(addresses, { signal: request.signal });
    return privateJson({
      version: TRANSFER_RECIPIENTS_VERSION,
      recipients: addresses.map((address) => ({ address, name: labels.get(address) ?? null })),
    } satisfies RecentTransferRecipientsResponse, 200);
  };
}

async function readRecentRows(
  dependencies: { store?: Pick<ActionsStore, "listDispatchedSends"> },
  owner: MoneyActionOwner,
): Promise<ActionRow[]> {
  try {
    return await (dependencies.store ?? getActionsStore()).listDispatchedSends(owner, 100);
  } catch {
    return [];
  }
}
