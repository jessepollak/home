import type { FundingDirection } from "./provider-contract";

export type FundingCorridorKey = `${string}:${string}:${FundingDirection}`;

export function fundingCorridorKey(providerId: string, region: string, direction: FundingDirection): FundingCorridorKey {
  return `${providerId}:${region}:${direction}`;
}

export type FundingOfferingSource = "deployment" | "saved";

export type FundingCorridorView = {
  key: FundingCorridorKey;
  providerId: string;
  providerName: string;
  region: string;
  regionName: string;
  direction: FundingDirection;
  currency: string;
  paymentMethods: string[];
  connection: "connected" | "not-connected";
  missingEnv: string[];
  credentials: Array<{ name: string; state: "set" | "unset" }>;
  selected: boolean;
  offered: boolean;
  confirmedBy: string | null;
  newSinceSave: boolean;
};

export type FundingProviderCredentialView = {
  providerId: string;
  displayName: string;
  credentials: Array<{ name: string; state: "set" | "unset" }>;
};

export type FundingLegacyVariableView = {
  name: string;
  state: "in-effect" | "ignored" | "unset";
};

export type FundingOfferingView = {
  source: FundingOfferingSource;
  revision: number;
  updatedAt: string | null;
  updatedBy: string | null;
  corridors: FundingCorridorView[];
  providers: FundingProviderCredentialView[];
  legacy: FundingLegacyVariableView[];
  unknownSaved: Array<{ providerId: string; region: string; direction: FundingDirection }>;
};
