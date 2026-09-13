// Route contract.
// POST /api/actions/:id/handle

import type { GetActionResponse } from "./get";

export type HandleActionRequest = {
  providerHandle?: string;
  transactionHash?: string;
};
export type HandleActionResponse = { action: Exclude<GetActionResponse, { calls: unknown }> };
