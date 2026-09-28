import "server-only";

import { getAddress, isAddress } from "viem";

export type ImmersveMode = "production" | "sandbox";
export type ImmersveConfig = Readonly<{
  mode: ImmersveMode;
  origin: "https://api.immersve.com" | "https://test.immersve.com";
  apiKey: string;
  apiSecret: string;
  partnerAccountId: string;
  clientApplicationId: string;
  cardProgramId: string;
  fundingChannelId: string;
  fundsStorageAddress: `0x${string}`;
  fundingType: "base-mainnet-usdc-universal-evm" | "base-sepolia-usdc-universal-evm";
}>;

const excludedAddresses = new Set([
  "0xcd1c3d1c12437bd0375e3c4331771b31220125bd",
  "0xe50ff3c352c0176c12c0a130dca7655ec518fc40",
  "0xf9e148f4d48350042fb8f18e98b089c9ada07bfb",
]);
const excludedChannel = "4cdc4310718674342d561647194e2446";
const idPattern = /^[a-fA-F0-9]{32}$/;

export function readImmersveConfig(env: Readonly<Record<string, string | undefined>> = process.env): ImmersveConfig | null {
  if (env.IMMERSVE_ENABLED !== "1") return null;
  const modeValue = env.IMMERSVE_MODE?.trim();
  if (modeValue && modeValue !== "sandbox") throw new Error("Invalid Immersve mode");
  const mode = modeValue === "sandbox" ? "sandbox" : "production";
  const required = [
    "IMMERSVE_API_KEY", "IMMERSVE_API_SECRET", "IMMERSVE_PARTNER_ACCOUNT_ID",
    "IMMERSVE_CLIENT_APPLICATION_ID", "IMMERSVE_CARD_PROGRAM_ID",
    "IMMERSVE_FUNDING_CHANNEL_ID", "IMMERSVE_FUNDS_STORAGE_ADDRESS", "IMMERSVE_FUNDING_TYPE",
  ] as const;
  const values: Record<string, string> = {};
  for (const name of required) {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Missing Immersve configuration: ${name}`);
    values[name] = value;
  }
  for (const name of ["IMMERSVE_PARTNER_ACCOUNT_ID", "IMMERSVE_CLIENT_APPLICATION_ID", "IMMERSVE_CARD_PROGRAM_ID", "IMMERSVE_FUNDING_CHANNEL_ID"]) {
    if (!idPattern.test(values[name])) throw new Error(`Invalid Immersve identifier: ${name}`);
  }
  if (values.IMMERSVE_FUNDING_CHANNEL_ID.toLowerCase() === excludedChannel) throw new Error("Public sandbox funding channel cannot be used by Home");
  const address = values.IMMERSVE_FUNDS_STORAGE_ADDRESS;
  if (!isAddress(address) || excludedAddresses.has(address.toLowerCase()) || /^0x0{40}$/i.test(address)) {
    throw new Error("Invalid Immersve Funds Storage address");
  }
  const fundingType = mode === "sandbox" ? "base-sepolia-usdc-universal-evm" : "base-mainnet-usdc-universal-evm";
  if (values.IMMERSVE_FUNDING_TYPE !== fundingType) throw new Error("Immersve funding type does not match mode");
  return Object.freeze({
    mode,
    origin: mode === "sandbox" ? "https://test.immersve.com" : "https://api.immersve.com",
    apiKey: values.IMMERSVE_API_KEY,
    apiSecret: values.IMMERSVE_API_SECRET,
    partnerAccountId: values.IMMERSVE_PARTNER_ACCOUNT_ID.toLowerCase(),
    clientApplicationId: values.IMMERSVE_CLIENT_APPLICATION_ID.toLowerCase(),
    cardProgramId: values.IMMERSVE_CARD_PROGRAM_ID.toLowerCase(),
    fundingChannelId: values.IMMERSVE_FUNDING_CHANNEL_ID.toLowerCase(),
    fundsStorageAddress: getAddress(address),
    fundingType,
  });
}
