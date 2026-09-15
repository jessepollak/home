export const BASE_CHAIN_ID = 8453 as const;
export const ACCOUNT_PROVIDER_HEADER = "X-Home-Account-Provider";

export type AccountProvider = "cdp-embedded" | "base-account";
export type AccountProviderRequest = AccountProvider | "restore";

export type VerifiedAccountSession = {
  user: {
    subject: string;
  };
  smartAccount: {
    address: `0x${string}`;
    chainId: typeof BASE_CHAIN_ID;
  } | null;
  accountProvider: AccountProvider;
};

/** HMAC-verified request identity used only to select signed local UI data. */
export type AccountRenderSeed = {
  session: VerifiedAccountSession;
  source: "home-session" | "cdp-hint";
};
