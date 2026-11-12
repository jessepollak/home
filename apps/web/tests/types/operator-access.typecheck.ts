import type { Named } from "@gdp-ts/core";
import type { OperatorSettingsStore } from "@/server/operator-settings/store";
import type { OperatorAccess, OperatorAddress } from "@/server/proofs/operator-access";

declare const store: OperatorSettingsStore;
declare const operator: Named<"operator", OperatorAddress>;
declare const proof: OperatorAccess<"operator">;
declare const otherProof: OperatorAccess<"other-operator">;
declare const input: { domain: string; expectedRevision: number; value: unknown };

export function typecheckOperatorAccess() {
  void store.write(input, operator, proof);
  // @ts-expect-error A settings write requires an authorization proof.
  void store.write(input, operator);
  // @ts-expect-error The authorization proof must be about this operator's name.
  void store.write(input, operator, otherProof);
}
