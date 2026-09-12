import { isBaseAccountEnabled } from "@/shared/account/session-types";
import { getCdpAccessTokenValidator } from "@/server/cdp/provider";
import { createSessionHandler } from "@/server/cdp/session";
import { createVaultPositionsReader } from "@/server/portfolio/inventory-vault-rpc";
import { createSavingsPositionsHandler } from "@/server/morpho/position-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const authorizeSession = createSessionHandler({
  getValidator: getCdpAccessTokenValidator,
  baseAccountEnabled: isBaseAccountEnabled(
    process.env.NEXT_PUBLIC_ENABLE_BASE_ACCOUNT,
  ),
});

const readPositions = createVaultPositionsReader();

export const GET = createSavingsPositionsHandler({
  authorize: authorizeSession,
  readPositions(account, signal) {
    return readPositions(account.address, signal);
  },
});
