import "server-only";

import { parseCardPurchases } from "@/shared/cards/transactions-contract";
import { isRecord } from "./response-guards";
import type { ProgramPurchase } from "./program";

export function isProgramPurchase(value: unknown): value is ProgramPurchase {
  if (!isRecord(value) || typeof value.id !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(value.id) ||
      typeof value.cardId !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(value.cardId) ||
      !(value.authorizationId === null || typeof value.authorizationId === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(value.authorizationId))) return false;
  try { parseCardPurchases({ version: 1, status: "ready", rows: [{ ...value, id: "11111111-1111-4111-8111-111111111111" }] }); return true; }
  catch { return false; }
}
