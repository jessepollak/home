import { createResolveAssetHandler } from "@/server/market-data/handlers/resolve-asset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createResolveAssetHandler();
