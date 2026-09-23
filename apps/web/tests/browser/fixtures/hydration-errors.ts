import type { Page } from "@playwright/test";

export function trackHydrationErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat/i.test(message.text())) errors.push(message.text());
  });
  page.on("pageerror", (error) => {
    if (/hydrat/i.test(error.message)) errors.push(error.message);
  });
  return errors;
}
