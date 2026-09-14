import { authorizeSession } from "@/server/auth/authorize";
import { createBorrowHandler } from "@/server/borrowing/handler";
import { getBaseMorphoMarkets } from "@/server/morpho-markets/rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createBorrowHandler({
  authorize: authorizeSession,
  rpc: getBaseMorphoMarkets,
});
