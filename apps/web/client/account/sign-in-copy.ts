export type SignInAvailability =
  | "unconfigured"
  | "provider-unavailable"
  | "ready";

export const CDP_SETUP_DOC_HREF =
  "https://github.com/jessepollak/home/blob/main/docs/cdp-setup.md";
export const CDP_SETUP_DOC_LABEL = "docs/cdp-setup.md";
export const BASE_ACCOUNT_DOC_HREF =
  "https://github.com/jessepollak/home/blob/main/docs/base-account.md";
export const BASE_ACCOUNT_DOC_LABEL = "docs/base-account.md";

export const signInUnconfiguredCopy = {
  heading: "Sign-in is not configured",
  lead: "Set HOME_SESSION_SECRET for Base Account sign-in, or NEXT_PUBLIC_CDP_PROJECT_ID for email sign-in.",
  hint: "Copy .env.example to apps/web/.env.local, then follow the Base Account or CDP setup guide.",
} as const;

export const signInProviderUnavailableCopy = {
  heading: "Sign-in is unavailable",
  body: "The sign-in service is not responding. Try again later.",
} as const;
