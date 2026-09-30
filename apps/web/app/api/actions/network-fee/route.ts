import { authorizeSession } from "@/server/auth/authorize";
import { createNetworkFeePolicyHandler } from "@/server/paymaster/policy";


export const GET = createNetworkFeePolicyHandler({ authorize: authorizeSession });
