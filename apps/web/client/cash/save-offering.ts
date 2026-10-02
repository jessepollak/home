import { offeredVaultMode, type ProductOffering } from "@/shared/operator-settings/products";
import { getVerifiedSaveVault } from "@/shared/savings/config";
import type { MorphoVaultCandidate } from "@/shared/savings/types";

export function depositOffered(offering: ProductOffering, candidate: MorphoVaultCandidate): boolean {
  if (offering.products.save !== "on") return false;
  const vault = getVerifiedSaveVault(candidate.vaultAddress);
  return vault === null || offeredVaultMode(offering, vault.id) === "enabled";
}

export function saveEntryOffered(
  offering: ProductOffering,
  candidates: readonly MorphoVaultCandidate[] | null | undefined,
): boolean {
  if (offering.products.save !== "on") return false;
  if (!candidates?.length) return Object.values(offering.vaults).some((mode) => mode === "enabled");
  return candidates.some((candidate) => depositOffered(offering, candidate));
}
