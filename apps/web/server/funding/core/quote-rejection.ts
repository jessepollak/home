import "server-only";

export class FundingQuoteRejectedError extends Error {
  constructor(readonly reason: "below-minimum" | "declined") {
    super("Funding quote rejected.");
  }
}
