import "server-only";

export class CodexMarketDataError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CodexMarketDataError";
  }
}
