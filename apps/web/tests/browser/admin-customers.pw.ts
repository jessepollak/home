import { expect, test, type Page, type Route } from "@playwright/test";
import { parseCustomerDetailResponse, parseCustomerSearchRequest, parseCustomerSearchResponse } from "@/shared/admin-customers/contract";
import { homeSessionToken } from "./fixtures/session";
import { expectNavigation } from "./fixtures/navigation-budget";
import { adminCustomerFixtureRoutes } from "./feature-map/admin-customers-fixture";
import { customerAdaDetail, customerAdaId, customerAdaMatch, customerList, customerNoEmailId, customerNoMatch, customerPartialDetail } from "./fixtures/admin-customers";

type Responder = (url: URL, body: unknown) => { status: number; json: unknown };

async function setup(page: Page, list: Responder, detail: Responder) {
  for (const [route, body] of adminCustomerFixtureRoutes()) {
    expect(/\/customers\/[0-9a-f-]{36}$/.test(route) ? parseCustomerDetailResponse(body) : parseCustomerSearchResponse(body)).not.toBeNull();
  }
  await page.context().addCookies([{ name: "home-session", value: homeSessionToken("0x1111111111111111111111111111111111111111"), domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
  await page.route(/\/api\/admin\/customers(?:\/|\?|$)/, async (route: Route) => {
    const url = new URL(route.request().url());
    const body: unknown = route.request().method() === "POST" ? route.request().postDataJSON() : null;
    const answer = url.pathname === "/api/admin/customers" ? list(url, body) : detail(url, body);
    await route.fulfill({ status: answer.status, json: answer.json, headers: { "Cache-Control": "private, no-store" } });
  });
}

const listBy: Responder = (_url, body) => {
  const parsed = parseCustomerSearchRequest(body);
  if (!parsed) return { status: 400, json: { error: { code: "INVALID_REQUEST" } } };
  const q = parsed.q;
  if (!q) return { status: 200, json: customerList };
  return { status: 200, json: q === "ada" ? customerAdaMatch : customerNoMatch };
};
const detailBy: Responder = (url) => url.pathname.endsWith(customerAdaId)
  ? { status: 200, json: customerAdaDetail }
  : url.pathname.endsWith(customerNoEmailId) ? { status: 200, json: customerPartialDetail } : { status: 404, json: { error: { code: "NOT_FOUND" } } };

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`customer search, detail and Back keep search state at ${viewport.width}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    await setup(page, listBy, detailBy);
    await page.goto("/admin/customers");
    await expect(page.getByRole("heading", { name: "Customers", exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("ada@example.test")).toBeVisible();
    await expect(page.getByText("No stored email · 1 wallet")).toBeVisible();
    await expect(page.getByText("Wallet-reported email")).toBeVisible();

    await page.getByRole("searchbox", { name: "Search customers" }).fill("nobody");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expectNavigation(page, /\/admin\/customers#q=nobody$/);
    await expect(page.getByText("No customers match this search.")).toBeVisible();

    await page.getByRole("searchbox", { name: "Search customers" }).fill("ada");
    await page.getByRole("searchbox", { name: "Search customers" }).press("Enter");
    await expectNavigation(page, /\/admin\/customers#q=ada$/);
    await expect(page.getByText("Matched by email prefix or provider order ID · 1 shown")).toBeVisible();
    await page.getByRole("link", { name: /ada@example\.test/ }).click();
    await expectNavigation(page, new RegExp(`/admin/customers/${customerAdaId}#q=ada$`));
    await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
    await expect(page.getByText("ada@example.test · Verified")).toBeVisible();
    await expect(page.getByText("$155.50")).toBeVisible();
    await expect(page.getByText("Result unknown")).toBeVisible();
    await expect(page.getByText("Succeeded")).toBeVisible();
    await expect(page.getByText("150.00 · coinbase (US)")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open conversation" })).toHaveAttribute("href", "/admin/support/dddddddd-dddd-4ddd-8ddd-dddddddddddd");

    await page.getByRole("main").getByRole("link", { name: "Customers", exact: true }).click();
    await expectNavigation(page, /\/admin\/customers#q=ada$/);
    await expect(page.getByRole("searchbox", { name: "Search customers" })).toHaveValue("ada");
    await page.getByRole("link", { name: /ada@example\.test/ }).click();
    await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
    await page.goBack();
    await expectNavigation(page, /\/admin\/customers#q=ada$/);
    await expect(page.getByRole("searchbox", { name: "Search customers" })).toHaveValue("ada");
  });
}

test("partial, not-found, failed and lost-authorization reads show distinct recoverable states", async ({ page }) => {
  test.setTimeout(60_000);
  let failing = true;
  let forbidden = false;
  await setup(page, (url, body) => {
    if (forbidden) return { status: 403, json: { error: { code: "OPERATOR_FORBIDDEN" } } };
    if (failing) return { status: 503, json: { error: { code: "CUSTOMERS_UNAVAILABLE" } } };
    return listBy(url, body);
  }, detailBy);
  await page.goto("/admin/customers");
  await expect(page.getByText("Customers couldn't load. Try again.")).toBeVisible({ timeout: 15_000 });
  failing = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("ada@example.test")).toBeVisible();
  const { promise: released, resolve: release } = Promise.withResolvers<void>();
  await page.route("**/api/admin/customers", async (route) => {
    await released;
    await route.fulfill({ status: 401, json: { error: { code: "UNAUTHENTICATED" } } });
  });
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByText("ada@example.test")).toHaveCount(0);
  release();
  await expect(page.getByText("Your session ended. Sign in again to view customers.")).toBeVisible();
  await page.unroute("**/api/admin/customers");

  await page.goto(`/admin/customers/${customerNoEmailId}`);
  await expect(page.getByText("No stored email")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Balances couldn't load. Reload to try again.")).toBeVisible();
  await expect(page.getByText("Funding orders couldn't load. Reload to try again.")).toBeVisible();
  await expect(page.getByText("No confirmed actions linked to this customer.")).toBeVisible();
  await expect(page.getByText("No support conversation.")).toBeVisible();

  await page.goto("/admin/customers/99999999-9999-4999-8999-999999999999");
  await expect(page.getByText("No customer has this ID.")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("link", { name: "Back to customers" }).click();
  await expectNavigation(page, /\/admin\/customers$/);

  forbidden = true;
  await page.getByRole("searchbox", { name: "Search customers" }).fill("ada");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("This account can no longer view customers.")).toBeVisible();
  await expect(page.getByText("ada@example.test")).toHaveCount(0);
});
