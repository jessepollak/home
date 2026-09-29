import { expect, test } from "bun:test";
import { getRedirectStatusCodeFromError, getURLFromRedirectError } from "next/dist/client/components/redirect";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import DashboardPage from "./page";

test("/dashboard redirects to /home", () => {
  try {
    DashboardPage();
    throw new Error("Expected a redirect");
  } catch (error) {
    if (!isRedirectError(error)) throw error;
    expect(getRedirectStatusCodeFromError(error)).toBe(307);
    expect(getURLFromRedirectError(error)).toBe("/home");
  }
});
