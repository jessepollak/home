import { describe, expect, test } from "bun:test";
import {
  CDP_SETUP_DOC_HREF,
  CDP_SETUP_DOC_LABEL,
  signInProviderUnavailableCopy,
  signInUnconfiguredCopy,
} from "./sign-in-copy";

describe("sign-in availability copy", () => {
  test("missing project ID copy is setup-specific and does not look like an outage", () => {
    expect(signInUnconfiguredCopy.heading).toBe("Sign-in is not configured");
    expect(signInUnconfiguredCopy.lead).toContain("NEXT_PUBLIC_CDP_PROJECT_ID");
    expect(signInUnconfiguredCopy.hint).toContain(".env.example");
    expect(signInUnconfiguredCopy.hint).toContain("apps/web/.env.local");
    expect(signInUnconfiguredCopy.heading).not.toBe(
      signInProviderUnavailableCopy.heading,
    );
    expect(signInUnconfiguredCopy.lead).not.toContain("unavailable");
    expect(signInUnconfiguredCopy.hint).not.toContain("Try again later");
  });

  test("configured provider-down copy is distinct and does not mention local setup", () => {
    expect(signInProviderUnavailableCopy.heading).toBe("Sign-in is unavailable");
    expect(signInProviderUnavailableCopy.body).toContain("Try again later");
    expect(signInProviderUnavailableCopy.body).not.toContain(
      "NEXT_PUBLIC_CDP_PROJECT_ID",
    );
    expect(signInProviderUnavailableCopy.body).not.toContain(".env.example");
    expect(CDP_SETUP_DOC_HREF).toContain("docs/cdp-setup.md");
    expect(CDP_SETUP_DOC_LABEL).toBe("docs/cdp-setup.md");
  });
});
