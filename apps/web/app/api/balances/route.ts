import { authorizeSession } from "@/server/auth/authorize";
import { createBalancesHandler } from "@/server/balances/handler";
import { getBalancesSnapshot } from "@/server/balances/coalesce";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = createBalancesHandler({
  authorize: authorizeSession,
  readBalances: getBalancesSnapshot,
});
