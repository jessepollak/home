// Route contract.
// POST /api/trades

export type TradesResponse = {
  error: {
    code: "HOSTED_SWAP_UNAVAILABLE";
    message: string;
  };
};
