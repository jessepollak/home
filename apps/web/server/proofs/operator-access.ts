import "server-only";

import { defineProof, name, type Named, type Proof } from "@gdp-ts/core";
import { decideOperatorAccess } from "@/server/operator/authorize";
import type { OperatorConfig } from "@/server/operator/config";
import type { VerifiedAccountSession } from "@/shared/account/session-types";

export type OperatorAddress = `0x${string}`;

const OperatorAccess = defineProof("OperatorAccess");

export type OperatorAccess<N> = Proof<"OperatorAccess", [N]>;

export function withOperatorAccess<R>(
  session: VerifiedAccountSession | null,
  config: OperatorConfig,
  run: <N>(operator: Named<N, OperatorAddress>, proof: OperatorAccess<N>) => R,
): { kind: "granted"; value: R } | { kind: "unauthenticated" } | { kind: "forbidden" } {
  const decision = decideOperatorAccess(session, config);
  if (decision.kind !== "operator") return decision;
  return { kind: "granted", value: name(decision.address, (operator) => run(operator, OperatorAccess.prove(operator))) };
}
