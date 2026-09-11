import { isBaseAccountEnabled } from "@/shared/account/session-types";
import { getCdpAccessTokenValidator } from "@/server/cdp/provider";
import { createSessionHandler } from "@/server/cdp/session";
import {
  getMorphoVaultPosition,
  MORPHO_V1_CANDIDATE_ADDRESSES,
} from "@/server/morpho";
import { createSavingsPositionsHandler } from "@/server/morpho/position-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const authorizeSession = createSessionHandler({
  getValidator: getCdpAccessTokenValidator,
  baseAccountEnabled: isBaseAccountEnabled(
    process.env.NEXT_PUBLIC_ENABLE_BASE_ACCOUNT,
  ),
});

export const GET = createSavingsPositionsHandler({
  authorize: authorizeSession,
  async readPositions(account, signal) {
    const fetchedAt = new Date().toISOString();
    const positions = await Promise.all(
      MORPHO_V1_CANDIDATE_ADDRESSES.map(async (vaultAddress) => ({
        vaultAddress,
        position: await getMorphoVaultPosition({
          account: {
            address: account.address,
            verification: "caller-verified-session-smart-account",
          },
          vaultAddress,
          signal,
        }),
      })),
    );

    return {
      accountAddress: account.address,
      fetchedAt,
      vaults: positions,
    };
  },
});
