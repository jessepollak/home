import { expect, test, type Page, type Route } from "@playwright/test";
import { parseOperatorSupportReplyRequest } from "@/shared/support/contract";
import { homeSessionToken } from "./fixtures/session";
import { expectNavigation } from "./fixtures/navigation-budget";
import { supportConversationId as id, supportOtherConversationId as otherId, supportReplyId, supportDetail, supportOlderDetail, supportReplayResponse, supportFreshResponse, supportList } from "./fixtures/operator-support";

function clientId(route: Route): string {
  const value: unknown = route.request().postDataJSON();
  const parsed = parseOperatorSupportReplyRequest(value);
  if (!parsed) throw new Error("Invalid operator reply request");
  return parsed.clientMessageId;
}
const path = `/admin/support/${id}`;
const replyPath = `**/api/admin/support/conversations/${id}/messages`;
async function setup(page: Page) {
  await page.context().addCookies([{ name: "home-session", value: homeSessionToken("0x1111111111111111111111111111111111111111"), domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
  await page.route(/\/api\/admin\/support\/conversations(?:\/|\?|$)/, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/read")) return route.fulfill({ status: 204 });
    if (url.pathname.endsWith("/conversations")) return route.fulfill({ json: supportList });
    if (url.searchParams.has("before")) return route.fulfill({ json: supportOlderDetail });
    return route.fulfill({ json: { ...supportDetail, conversation: { ...supportDetail.conversation, id: url.pathname.endsWith(otherId) ? otherId : id } } });
  });
  await page.goto(path);
  await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toBeVisible();
}
async function send(page: Page, body = "We can help") {
  await page.getByRole("textbox", { name: "Reply", exact: true }).fill(body);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}
async function deferredReply(page: Page) {
  let release: ((value: unknown) => Promise<void>) | undefined = undefined;
  const { promise: received, resolve: requested } = Promise.withResolvers<void>();
  await page.route(replyPath, async (route) => {
    await new Promise<void>((resolve) => { release = async (json) => { await route.fulfill({ json }); resolve(); }; requested(); });
  });
  return { received, release: (value: unknown) => {
    if (!release) throw new Error("Expected a pending operator reply request");
    return release(value);
  } };
}

for (const width of [1280, 390]) {
  test(`reply replay outside page retains draft and reviews older history at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
    await setup(page);
    const sentIds: string[] = [];
    await page.route(replyPath, async (route) => {
      sentIds.push(clientId(route));
      if (sentIds.length === 1) return route.abort("failed");
      return route.fulfill({ json: supportReplayResponse });
    });
    await send(page);
    await expect(page.getByRole("region", { name: "Conversation", exact: true }).getByRole("alert")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("We can help");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Already sent");
    expect(sentIds).toHaveLength(2);
    expect(sentIds[1]).toBe(sentIds[0]);
    await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("We can help");
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
    await expect(page.getByRole("log")).not.toContainText("We can help");
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.getByRole("status")).toHaveText("Already sent");
    await page.getByRole("button", { name: "Review thread" }).click();
    await expect(page.locator(`[data-message-id="${supportReplyId}"]`)).toBeFocused();
    await expect(page.getByRole("status")).toHaveText("Already sent");
    await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("We can help");
    await page.getByRole("button", { name: "New reply" }).click();
    await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("");
    await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toBeFocused();
    await expect(page.getByRole("status")).toHaveCount(0);
    await page.route(replyPath, (route) => { sentIds.push(clientId(route)); return route.fulfill({ status: 201, json: supportFreshResponse }); });
    await send(page);
    await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("");
    expect(sentIds[2]).not.toBe(sentIds[0]);
  });
}

for (const replayed of [false, true]) {
  test(`late ${replayed ? "replay" : "fresh"} response preserves edited draft`, async ({ page }) => {
    await setup(page);
    const pending = await deferredReply(page);
    await send(page);
    await pending.received;
    await page.getByRole("textbox", { name: "Reply", exact: true }).fill("A different reply");
    await pending.release(replayed ? supportReplayResponse : supportFreshResponse);
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
    await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("A different reply");
    if (replayed) {
      await expect(page.getByRole("status")).toHaveText("Already sent");
      await page.getByRole("button", { name: "New reply" }).click();
      await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("A different reply");
    }
  });
}

test("fresh response cannot clear a draft edited back to the original text", async ({ page }) => {
  await setup(page);
  const pending = await deferredReply(page);
  await send(page);
  await pending.received;
  const composer = page.getByRole("textbox", { name: "Reply", exact: true });
  await composer.fill("Edited reply");
  await composer.fill("We can help");
  await pending.release(supportFreshResponse);
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  await expect(composer).toHaveValue("We can help");
});

test("replay inside page reviews the matched message without requesting earlier history", async ({ page }) => {
  await setup(page);
  let earlierRequests = 0;
  await page.route(`**/api/admin/support/conversations/${id}?before=*`, (route) => { ++earlierRequests; return route.fulfill({ json: supportOlderDetail }); });
  await page.route(replyPath, (route) => route.fulfill({ json: { ...supportFreshResponse, reply: { messageId: supportReplyId, replayed: true } } }));
  await send(page);
  await expect(page.getByRole("status")).toHaveText("Already sent");
  await page.getByRole("button", { name: "Review thread" }).click();
  await expect(page.locator(`[data-message-id="${supportReplyId}"]`)).toBeFocused();
  expect(earlierRequests).toBe(0);
  await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("We can help");
});

test("late replay cannot return through A-B-A navigation or unmount", async ({ page }) => {
  await setup(page);
  const pending = await deferredReply(page);
  await send(page);
  await pending.received;
  await page.getByRole("link", { name: /other@example.com/ }).click();
  await expectNavigation(page, new RegExp(`${otherId}$`));
  await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("");
  await page.getByRole("link", { name: /customer@example.com/ }).click();
  await expectNavigation(page, new RegExp(`${id}$`));
  await page.getByRole("textbox", { name: "Reply", exact: true }).fill("New view draft");
  await pending.release(supportReplayResponse);
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("New view draft");
  await expect(page.getByRole("status")).toHaveCount(0);
  const unmounted = await deferredReply(page);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await unmounted.received;
  await page.getByRole("navigation", { name: "Operator sections" }).getByRole("link", { name: "Support", exact: true }).click();
  await expectNavigation(page, /\/admin\/support$/);
  await unmounted.release(supportReplayResponse);
  await page.getByRole("link", { name: /customer@example.com/ }).click();
  await expectNavigation(page, new RegExp(`${id}$`));
  await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("");
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("review failure and ordinary pagination never dismiss replay", async ({ page }) => {
  await setup(page);
  await page.route(replyPath, (route) => route.fulfill({ json: supportReplayResponse }));
  await send(page);
  await expect(page.getByRole("status")).toHaveText("Already sent");
  await page.route(`**/api/admin/support/conversations/${id}?before=*`, (route) => route.fulfill({ status: 503, json: { error: { code: "SUPPORT_UNAVAILABLE" } } }));
  await page.getByRole("button", { name: "Review thread" }).click();
  await expect(page.getByText("Couldn't review this reply. Try again.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("We can help");
  await page.route(`**/api/admin/support/conversations/${id}?before=*`, (route) => route.fulfill({ json: supportOlderDetail }));
  await page.getByRole("button", { name: "Load earlier messages" }).click();
  await expect(page.getByRole("log")).toContainText("We can help");
  await expect(page.getByRole("status")).toHaveText("Already sent");
  await page.getByRole("button", { name: "Review thread" }).click();
  await expect(page.locator(`[data-message-id="${supportReplyId}"]`)).toBeFocused();
});

for (const failure of ["malformed", "wrong-conversation", "timeout", "conflict", "unavailable"] as const) {
  test(`${failure} reply response retains same retry identity`, async ({ page }) => {
    await setup(page);
    const requests: string[] = [];
    await page.route(replyPath, async (route: Route) => {
      requests.push(clientId(route));
      if (requests.length > 1) return route.fulfill({ json: supportReplayResponse });
      if (failure === "timeout") return route.abort("timedout");
      if (failure === "malformed") return route.fulfill({ json: supportDetail });
      if (failure === "wrong-conversation") return route.fulfill({ json: { ...supportReplayResponse, conversation: { ...supportReplayResponse.conversation, id: otherId } } });
      return route.fulfill({ status: failure === "conflict" ? 409 : 503, json: { error: { code: failure === "conflict" ? "SUPPORT_CONFLICT" : "SUPPORT_UNAVAILABLE" } } });
    });
    await send(page);
    await expect(page.getByRole("region", { name: "Conversation", exact: true }).getByRole("alert")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("We can help");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Already sent");
    expect(requests[1]).toBe(requests[0]);
  });
}
