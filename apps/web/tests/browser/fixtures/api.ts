import type { Page, Route } from "@playwright/test";
import type { RegionId } from "../../../config/regions";
import type { BalancesSnapshot } from "../../../shared/balances/types";
import { FIXED_NOW, installFixedPageDate } from "./fixed-time";
import { balancesSnapshot } from "./balances";
import { savingsPrepareFixture } from "../feature-map/savings-fixture";
import { COUNTRY_PREFERENCE_VERSION, parseCountryPreferenceRequest } from "../../../shared/account/contracts/country-preference";
import { FUNDING_OPEN_ORDER_VERSION } from "../../../shared/funding/contracts/open-order";
import { FUNDING_ORDER_VERSION } from "../../../shared/funding/contracts/order";
import { FUNDING_PROVIDERS_VERSION } from "../../../shared/funding/contracts/providers";
import { activityOrdersFixture, cardPurchasesFixture, fundingOrderCancellationFixture } from "../feature-map/fixtures";
import { isRecord } from "../../../shared/guards";
import {
  actionsBody,
  basenameProfileBody,
  fundingProvidersBody,
  savingsVaultsBody,
  sessionBody,
} from "./bodies";

export const RECIPIENT = "0x2222222222222222222222222222222222222222";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const PAYMASTER = "0x2FAEB0760D4230Ef2aC21496Bb4F0b47D634FD4c";
const APPROVE = `0x095ea7b3${PAYMASTER.slice(2).toLowerCase().padStart(64, "0")}${BigInt(20_000).toString(16).padStart(64, "0")}`;
const ACTION_ID = "11111111-1111-4111-8111-111111111111";
const USER_OPERATION_HASH = `0x${"ab".repeat(32)}`;
const TRANSACTION_HASH = `0x${"cd".repeat(32)}`;
const CREATED_AT = new Date(FIXED_NOW).toISOString();
const EXPIRES_AT = new Date(FIXED_NOW + 10 * 60_000).toISOString();

function activityPageBody(windowEnd: string | null, currency: string) {
  const to = windowEnd ?? new Date(FIXED_NOW).toISOString();
  const toTime = new Date(to).getTime();
  const wallet = sessionBody.smartAccount.address.toLowerCase();
  return {
    version: 1,
    walletAddress: wallet,
    chainId: 8453,
    currency,
    window: { from: new Date(toTime - 24 * 60 * 60_000).toISOString(), to },
    transfers: [{
      id: `8453:${USDC}:received-fixture`,
      logId: "received-fixture",
      chainId: 8453,
      assetId: "usdc",
      tokenAddress: USDC,
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      tokenImageUrl: null,
      walletAddress: wallet,
      fromAddress: RECIPIENT,
      toAddress: wallet,
      direction: "incoming",
      amountBaseUnits: "25000000",
      blockNumber: "1",
      blockHash: `0x${"ef".repeat(32)}`,
      transactionHash: `0x${"12".repeat(32)}`,
      logIndex: "1",
      blockTimestamp: new Date(toTime - 60 * 60_000).toISOString(),
      valuation: currency === "USD"
        ? {
          status: "priced",
          currency,
          amount: { atoms: "25000000000000000000", scale: 18 },
          method: "peg",
          peg: "USD",
          close: null,
          fx: null,
        }
        : { status: "unpriced", currency, reason: "fx-unavailable" },
    }],
    cards: { status: "ready", rows: cardPurchasesFixture(to) },
    nextCursor: null,
    source: {
      provider: "cdp-sql",
      cached: false,
      stale: false,
      executionTimestamp: to,
      executionTimeMs: 1,
      fetchedAt: to,
    },
  };
}

type ActionStatus = "unconfirmed" | "pending" | "confirmed";

export function preparedSendFixtureAction(recipient = RECIPIENT) {
  return {
    id: ACTION_ID,
    owner: {
      subject: "playwright-smoke-subject",
      address: sessionBody.smartAccount.address,
      chainId: 8453,
      accountProvider: "cdp-embedded",
    },
    kind: "send",
    title: "Send USDC",
    networkFee: { payment: "usdc", token: USDC, paymaster: PAYMASTER, maxFeeBaseUnits: "20000", decimals: 6 },
    calls: [{ to: USDC, data: APPROVE, value: "0" }, {
      to: USDC,
      data: `0xa9059cbb${recipient.slice(2).padStart(64, "0")}${BigInt(1_000_000).toString(16).padStart(64, "0")}`,
      value: "0",
    }],
    amounts: [{
      assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "spend",
    }],
    warnings: [`Recipient: ${recipient}`],
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
  };
}

export async function json(route: Route, body: unknown) {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

export function seedSignedInSession(page: Page, country = "US") {
  return page.addInitScript((region) => {
    sessionStorage.setItem("home:playwright-smoke:signed-in", "1");
    localStorage.setItem("home.country.v2", region);
  }, country);
}

export async function installApiFixtures(
  page: Page,
  options: { balances?: BalancesSnapshot; countryPreferenceRegion?: RegionId; clock?: "date" | "playwright" | "system"; activityOrders?: boolean } = {},
) {
  if (options.clock === "playwright") await page.clock.install({ time: FIXED_NOW });
  else if (options.clock !== "system") await installFixedPageDate(page);
  let status: ActionStatus = "unconfirmed";
  let balancesReads = 0;
  const balancesReadsByRegion = new Map<RegionId, number>();
  let delayedSession: Promise<void> | null = null;
  let releaseDelayedSession: (() => void) | null = null;
  let resolveSessionObserved: (() => void) | null = null;
  let delayedBalances: Promise<void> | null = null;
  let releaseDelayedBalances: (() => void) | null = null;
  let resolveBalancesObserved: (() => void) | null = null;
  let handleRecorded = false;
  let failHandleResponseOnce = true;
  let fundingStatusReads = 0;
  const activityOrders = activityOrdersFixture();
  const currentAction = preparedSendFixtureAction();

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === "/api/session") {
      resolveSessionObserved?.();
      resolveSessionObserved = null;
      if (delayedSession) await delayedSession;
      return json(route, sessionBody);
    }
    if (path === "/api/balances") {
      const region = (url.searchParams.get("region") ?? "US") as RegionId;
      balancesReads += 1;
      balancesReadsByRegion.set(region, (balancesReadsByRegion.get(region) ?? 0) + 1);
      resolveBalancesObserved?.();
      resolveBalancesObserved = null;
      if (delayedBalances) await delayedBalances;
      return json(route, options.balances ?? balancesSnapshot(region));
    }
    if (path === "/api/actions/network-fee") return json(route, { version: 1, usdcReserveBaseUnits: "20000" });
    if (path === "/api/actions/prepare" && request.method() === "POST") {
      const body = request.postDataJSON() as { kind?: string; params?: { vaultAddress?: `0x${string}`; amountBaseUnits?: string } };
      if (body.kind === "savings-deposit" || body.kind === "savings-withdraw") {
        return json(route, savingsPrepareFixture({
          operation: body.kind === "savings-deposit" ? "deposit" : "withdraw",
          vaultAddress: body.params?.vaultAddress,
          amountBaseUnits: body.params?.amountBaseUnits,
        }));
      }
      status = "unconfirmed";
      return json(route, currentAction);
    }
    if (path === `/api/actions/${ACTION_ID}/confirm`) {
      status = "pending";
      return json(route, {
        id: ACTION_ID,
        calls: currentAction.calls,
        summary: {
          title: currentAction.title,
          amounts: currentAction.amounts,
          warnings: currentAction.warnings,
          expiresAt: EXPIRES_AT,
        },
        expiresAt: EXPIRES_AT,
      });
    }
    if (path === `/api/actions/${ACTION_ID}/handle`) {
      const body = request.postDataJSON() as { transactionHash?: string };
      if (body.transactionHash) {
        status = "confirmed";
        return json(route, {
          action: {
            id: ACTION_ID, status, providerHandle: USER_OPERATION_HASH,
            transactionHash: body.transactionHash,
          },
        });
      }
      handleRecorded = true;
      if (failHandleResponseOnce) {
        failHandleResponseOnce = false;
        return route.abort("failed");
      }
      return json(route, {
        action: { id: ACTION_ID, status: "pending", providerHandle: USER_OPERATION_HASH },
      });
    }
    if (path === `/api/actions/${ACTION_ID}`) {
      return json(route, status === "unconfirmed"
        ? {
            id: ACTION_ID,
            kind: "send",
            summary: {
              title: currentAction.title,
              networkFee: currentAction.networkFee,
              amounts: currentAction.amounts,
              warnings: currentAction.warnings,
              expiresAt: EXPIRES_AT,
            },
            calls: currentAction.calls,
            expiresAt: EXPIRES_AT,
          }
        : {
            action: {
              id: ACTION_ID,
              status: "pending",
              providerHandle: handleRecorded ? USER_OPERATION_HASH : undefined,
            },
          });
    }
    if (path === "/api/actions") {
      const actions = status === "unconfirmed" ? actionsBody.actions : [{
        id: ACTION_ID,
        provider: "cdp-embedded",
        kind: "send",
        summary: {
          title: currentAction.title,
          amounts: currentAction.amounts,
          warnings: currentAction.warnings,
          expiresAt: EXPIRES_AT,
        },
        status,
        createdAt: CREATED_AT,
        confirmedAt: CREATED_AT,
        providerHandle: handleRecorded ? USER_OPERATION_HASH : undefined,
        submittedAt: handleRecorded ? CREATED_AT : undefined,
        transactionHash: status === "confirmed" ? TRANSACTION_HASH : undefined,
        owner: currentAction.owner,
      }];
      return json(route, { ...actionsBody, actions });
    }
    if (path === "/api/funding/providers") {
      const direction = url.searchParams.get("direction") ?? "onramp";
      return json(route, url.searchParams.get("region") === "ID" && direction !== "offramp" ? {
        version: FUNDING_PROVIDERS_VERSION, direction: "onramp",
        providers: [{
          direction: "onramp", providerId: "idrx", displayName: "IDRX", region: "ID", assetId: "base:idrx",
          assetSymbol: "IDRX", assetDecimals: 2, currency: "IDR",
          paymentMethods: [{ id: "bank-va-mandiri", label: "Bank transfer · Mandiri" }],
          quotes: false, customerSetup: null,
        }],
      } : direction === "offramp" ? { ...fundingProvidersBody, direction: "offramp" } : fundingProvidersBody);
    }
    if (path === "/api/funding/quotes") {
      return json(route, {
        version: 1,
        quoteToken: "fixture-signed-quote",
        quote: { fiatAmount: "20000", tokenAmountAtomic: "2000000", fees: [], expiresAt: EXPIRES_AT },
      });
    }
    if (path === "/api/funding/orders" && request.method() === "POST") {
      return json(route, {
        version: FUNDING_ORDER_VERSION,
        order: {
          id: ACTION_ID, providerId: "idrx", region: "ID", assetId: "base:idrx",
          paymentMethod: "bank-va-mandiri", fiatAmount: "20000", state: "awaiting-payment",
          expectedTokenAmountAtomic: "2000000",
          fees: [{ label: "Network", amount: "100", currency: "IDR" }],
          instructions: {
            kind: "bank-transfer", rail: "Mandiri virtual account", accountNumber: "123456789012",
            accountName: "Home Fixture", amount: "20000", currency: "IDR",
          },
          providerStatus: "pending",
        },
      });
    }
    if (path.endsWith("/cancel") && path.startsWith("/api/funding/orders/") && request.method() === "POST") {
      const id = path.split("/").at(-2);
      const order = activityOrders.orders.find((entry) => entry.kind === "funding" && entry.id === id);
      const matchesVersion = () => {
        const body: unknown = request.postDataJSON();
        return isRecord(body) && body.version === 1;
      };
      if (order?.kind !== "funding" || order.stage !== "awaiting-payment" || !matchesVersion()) {
        return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "ORDER_NOT_CANCELLABLE", message: "This deposit can no longer be cancelled." } }) });
      }
      activityOrders.orders = activityOrders.orders.map((entry) => entry.id === id && entry.kind === "funding"
        ? { ...entry, stage: "cancelled", abandonReason: "owner", status: "failed", resumable: false, instruction: null } : entry);
      return json(route, fundingOrderCancellationFixture(order.id));
    }
    if (path === "/api/funding/orders" && request.method() === "GET") return json(route, { version: FUNDING_OPEN_ORDER_VERSION, order: null });
    if (path === `/api/funding/orders/${ACTION_ID}`) {
      fundingStatusReads += 1;
      return json(route, {
        version: FUNDING_ORDER_VERSION,
        order: {
          id: ACTION_ID, providerId: "idrx", region: "ID", assetId: "base:idrx",
          paymentMethod: "bank-va-mandiri", fiatAmount: "20000",
          state: fundingStatusReads > 0 ? "received" : "awaiting-payment",
          instructions: null, providerStatus: "completed",
        },
      });
    }
    if (path === "/api/savings/vaults") {
      return json(route, savingsVaultsBody("2026-09-12T12:00:00.000Z", "2026-09-12T12:00:01.000Z"));
    }
    if (path === "/api/activity") {
      return json(
        route,
        activityPageBody(url.searchParams.get("to"), url.searchParams.get("currency") ?? "USD"),
      );
    }
    if (path === "/api/activity/orders" && options.activityOrders) return json(route, activityOrders);
    if (path === "/api/activity/orders") return json(route, {
      version: 1, owner: { subject: sessionBody.user.subject, accountProvider: sessionBody.accountProvider }, orders: [],
    });
    if (path === "/api/account/country-preference") {
      if (request.method() === "PUT") {
        const body = parseCountryPreferenceRequest(request.postDataJSON());
        if (!body) return route.fulfill({ status: 400, contentType: "application/json", body: "{}" });
        return json(route, { version: COUNTRY_PREFERENCE_VERSION, regionId: body.regionId });
      }
      return json(route, { version: COUNTRY_PREFERENCE_VERSION, regionId: options.countryPreferenceRegion ?? null });
    }
    if (path === "/api/invites/link") return json(route, { version: 1, code: "abcdefghjk" });
    if (path === "/api/support/chat" && request.method() === "POST") {
      const conversationId = "11111111-1111-4111-8111-111111111111";
      const messageId = "22222222-2222-4222-8222-222222222222";
      const events = [
        { type: "start", messageId },
        { type: "text-start", id: messageId },
        { type: "text-delta", id: messageId, delta: "I can help with that. What would you like to know?" },
        { type: "text-end", id: messageId },
        { type: "data-support", data: { handler: "assistant", conversationId } },
      ];
      return route.fulfill({
        status: 200, contentType: "text/event-stream",
        headers: { "x-vercel-ai-ui-message-stream": "v1", "cache-control": "private, no-store, max-age=0" },
        body: `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`,
      });
    }
    if (path === "/api/support/summary") return json(route, { version: 2, unreadCount: 0 });
    if (path === "/api/support" && request.method() === "GET") return json(route, { version: 2, conversation: null, assistant: { available: true, handoff: false } });
    if (path === "/api/basename-profile") return json(route, basenameProfileBody);
    return json(route, {});
  });

  return {
    balancesReads: () => balancesReads,
    balancesReadsForRegion: (region: RegionId) => balancesReadsByRegion.get(region) ?? 0,
    delayNextSession() {
      delayedSession = new Promise<void>((resolve) => { releaseDelayedSession = resolve; });
      return new Promise<void>((resolve) => { resolveSessionObserved = resolve; });
    },
    releaseSession() {
      releaseDelayedSession?.();
      delayedSession = null;
      releaseDelayedSession = null;
    },
    delayNextBalances() {
      delayedBalances = new Promise<void>((resolve) => { releaseDelayedBalances = resolve; });
      return new Promise<void>((resolve) => { resolveBalancesObserved = resolve; });
    },
    releaseBalances() {
      releaseDelayedBalances?.();
      delayedBalances = null;
      releaseDelayedBalances = null;
    },
  };
}
