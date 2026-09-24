export type ResourceFailureKind = "session" | "network" | "http" | "parse" | "access";

export class ResourceFailure extends Error {
  constructor(
    readonly kind: ResourceFailureKind,
    message = "Authenticated resource is unavailable.",
    readonly status?: number,
  ) {
    super(message);
    this.name = "ResourceFailure";
  }
}

export function isInterruptionEligible(error: unknown): boolean {
  return error instanceof ResourceFailure &&
    (error.kind === "network" || (error.kind === "http" && (error.status ?? 0) >= 500));
}
