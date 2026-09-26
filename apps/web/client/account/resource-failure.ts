import { TransferExecutionError } from "@/shared/transfers/types";

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

export function isTransientAccountResourceFailure(error: unknown): boolean {
  if (!(error instanceof TransferExecutionError) || error.reason !== "unavailable") return false;
  const tagged = error as TransferExecutionError & { kind?: unknown; status?: unknown };
  return tagged.kind === "network" || (tagged.kind === "http" &&
    (tagged.status === 429 || (typeof tagged.status === "number" && tagged.status >= 500 && tagged.status <= 599)));
}

export function isInterruptionEligible(error: unknown): boolean {
  return error instanceof ResourceFailure &&
    (error.kind === "network" || (error.kind === "http" && (error.status ?? 0) >= 500));
}
