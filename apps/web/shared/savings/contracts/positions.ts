
import { MORPHO_API_VERSION, type Address, type MorphoSource } from "./vaults";

export type MorphoVaultPosition = {
  version: typeof MORPHO_API_VERSION;
  accountAddress: Address;
  vaultAddress: Address;
  assetsRaw: string | null;
  sharesRaw: string;
  indexedAt: string;
  source: MorphoSource;
  withdrawableRaw: null;
  withdrawableNote: string;
};
