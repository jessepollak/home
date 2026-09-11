export type SignInAvailability =
  | "unconfigured"
  | "provider-unavailable"
  | "ready";

export const CDP_SETUP_DOC_HREF =
  "https://github.com/jessepollak/home/blob/main/docs/cdp-setup.md";
export const CDP_SETUP_DOC_LABEL = "docs/cdp-setup.md";

export const signInUnconfiguredCopy = {
  heading: "Sign-in is not configured",
  lead: "This deployment is missing NEXT_PUBLIC_CDP_PROJECT_ID.",
  hint: "Copy .env.example to apps/web/.env.local, then follow the CDP setup guide.",
} as const;

export const signInProviderUnavailableCopy = {
  heading: "Sign-in is unavailable",
  body: "The sign-in service is not responding. Try again later.",
} as const;
