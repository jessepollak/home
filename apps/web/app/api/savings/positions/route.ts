import { authorizeSession } from "@/server/auth/authorize";
import { createSavingsPositionsHandler } from "@/server/morpho/position-handler";
import { createVaultPositionsReader } from "@/server/portfolio/inventory-vault-rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const readPositions = createVaultPositionsReader();

export const GET = createSavingsPositionsHandler({
  authorize: authorizeSession,
  readPositions(account, signal) {
    return readPositions(account.address, signal);
  },
});
