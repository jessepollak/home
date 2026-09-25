import { authorizeSession } from "@/server/auth/authorize";
import { createNetworkFeePolicyHandler } from "@/server/paymaster/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createNetworkFeePolicyHandler({ authorize: authorizeSession });
