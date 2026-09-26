import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { balancesSnapshot } from "./fixtures/balances";
import { typeAmount } from "./fixtures/type-amount";

const OWNER = "0x1111111111111111111111111111111111111111";
const PINNED_RECIPIENT = "0x2211d1D0020DAEA8039E46Cf1367962070d77DA9";
const PINNED_RECIPIENT_TRIGGER = "Show full address 0x2211…d77DA9";
const RECENT_RECIPIENT = "0x3333333333333333333333333333333333333333";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const ACTION_ID = "11111111-1111-4111-8111-111111111111";
const CREATED_AT = new Date().toISOString();
const EXPIRES_AT = new Date(Date.now() + 10 * 60_000).toISOString();

const sendAction = {
  id: ACTION_ID,
  owner: {
    subject: "playwright-smoke-subject",
    address: OWNER,
    chainId: 8453,
    accountProvider: "cdp-embedded",
  },
  kind: "send",
  title: "Send USDC",
  calls: [{
    to: USDC,
    data: `0xa9059cbb${PINNED_RECIPIENT.slice(2).padStart(64, "0")}${BigInt(1_000_000).toString(16).padStart(64, "0")}`,
    value: "0",
  }],
  amounts: [{
    assetId: "usdc",
    symbol: "USDC",
    decimals: 6,
    amountBaseUnits: "1000000",
    direction: "spend",
  }],
  warnings: [`Recipient: ${PINNED_RECIPIENT}`, "Network fee shown by wallet."],
  createdAt: CREATED_AT,
  expiresAt: EXPIRES_AT,
};

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function seedSignedInSession(page: Page) {
  return page.addInitScript(() => {
    sessionStorage.setItem("home:playwright-smoke:signed-in", "1");
    localStorage.setItem("home.country.v2", "US");
  });
}

async function installRecipientFixtures(
  page: Page,
  options: { resolves?: Record<string, string>; recents?: Array<{ address: string; name: string | null }> } = {},
) {
  const resolves = options.resolves ?? { "example.base.eth": PINNED_RECIPIENT };
  const recents = options.recents ?? [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === "/api/session") {
      return json(route, {
        user: { subject: "playwright-smoke-subject" },
        smartAccount: { address: OWNER, chainId: 8453 },
        accountProvider: "cdp-embedded",
      });
    }
    if (path === "/api/balances") return json(route, balancesSnapshot("US"));
    if (path === "/api/transfers/recipient-name") {
      const name = url.searchParams.get("name") ?? "";
      const address = resolves[name];
      return address
        ? json(route, { version: 1, name, address })
        : json(route, { error: { code: "RECIPIENT_NAME_UNRESOLVED", message: "That name does not resolve to an address." } }, 404);
    }
    if (path === "/api/transfers/recent-recipients") return json(route, { version: 1, recipients: recents });
    if (path === "/api/actions/network-fee") return json(route, { version: 1, usdcReserveBaseUnits: "20000" });
    if (path === "/api/actions/prepare" && request.method() === "POST") return json(route, sendAction, 201);
    if (path === "/api/actions") return json(route, { actions: [] });
    if (path === `/api/actions/${ACTION_ID}`) {
      return json(route, {
        id: ACTION_ID,
        kind: "send",
        summary: {
          title: sendAction.title,
          amounts: sendAction.amounts,
          warnings: sendAction.warnings,
          expiresAt: EXPIRES_AT,
        },
        calls: sendAction.calls,
        expiresAt: EXPIRES_AT,
      });
    }
    if (path === `/api/actions/${ACTION_ID}/confirm`) {
      return json(route, {
        id: ACTION_ID,
        calls: sendAction.calls,
        summary: {
          title: sendAction.title,
          amounts: sendAction.amounts,
          warnings: sendAction.warnings,
          expiresAt: EXPIRES_AT,
        },
        expiresAt: EXPIRES_AT,
      });
    }
    return json(route, {});
  });
}

async function openDestinationStep(page: Page) {
  await page.getByRole("button", { name: "Send" }).click();
  await typeAmount(page, "1");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("textbox", { name: "To" })).toBeVisible();
}

async function expectRevealedRecipient(page: Page, scope: Page | Locator) {
  const trigger = scope.getByRole("button", { name: PINNED_RECIPIENT_TRIGGER });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const popover = page.getByRole("dialog", { name: "Full address" });
  await expect(popover.getByLabel(`Full address ${PINNED_RECIPIENT}`)).toHaveText(PINNED_RECIPIENT);
  await expect(popover.getByRole("button", { name: "Copy address" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(trigger).toBeFocused();
}

async function openReview(page: Page) {
  const continueButton = page.getByRole("button", { name: "Continue" });
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  return page.getByRole("dialog", { name: "Confirm" });
}

test("resolves a Basename into the destination and the review address", async ({ page }) => {
  await seedSignedInSession(page);
  await installRecipientFixtures(page);
  await page.goto("/home");
  await openDestinationStep(page);

  await page.getByRole("textbox", { name: "To" }).fill("example.base.eth");

  await expectRevealedRecipient(page, page);
  const review = await openReview(page);
  await expectRevealedRecipient(page, review);
});

test("keeps Continue disabled with an inline error for an unresolved name and recovers", async ({ page }) => {
  await seedSignedInSession(page);
  await installRecipientFixtures(page);
  await page.goto("/home");
  await openDestinationStep(page);

  await page.getByRole("textbox", { name: "To" }).fill("missing.base.eth");

  await expect(page.getByRole("alert")).toHaveText("We couldn't resolve missing.base.eth. Check the name and try again.");
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();

  await page.getByRole("textbox", { name: "To" }).fill(PINNED_RECIPIENT);

  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
});

test("fills To from a recent recipient and reviews the full address", async ({ page }) => {
  await seedSignedInSession(page);
  await installRecipientFixtures(page, {
    recents: [
      { address: PINNED_RECIPIENT, name: "example.base.eth" },
      { address: RECENT_RECIPIENT, name: null },
    ],
  });
  await page.goto("/home");
  await openDestinationStep(page);

  await expect(page.getByText("Recent recipients")).toBeVisible();
  await page.getByRole("button", { name: /example\.base\.eth/ }).click();

  await expect(page.getByRole("textbox", { name: "To" })).toHaveValue("0x2211…d77DA9");
  const review = await openReview(page);
  await expectRevealedRecipient(page, review);
});
