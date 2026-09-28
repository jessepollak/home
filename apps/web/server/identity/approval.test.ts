import { expect, test } from "bun:test";
import { IdentityService } from "./service";
import { MemoryIdentityStore } from "./store";
import type { IdentityConfig } from "./sumsub";

const config: IdentityConfig = { token: "sbx:synthetic-token", requestKey: "synthetic-request-key-000", digestKey: "synthetic-digest-key-000", providerEnv: "sandbox", level: "home-level", supportUrl: "https://support.example.com" };
test("card gating approval rejects wrong-level, inactive and restricted facts", async () => {
  const store = new MemoryIdentityStore();
  const customerId = "11111111-1111-4111-8111-111111111111";
  const at = "2026-04-30T08:04:23.379Z";
  const row = await store.reserve({ customerId, env: "sandbox", externalUserId: `home-${"a".repeat(32)}`, level: "home-level", consentVersion: "1", at });
  const event = { source: "reconcile" as const, configuredLevel: "home-level" };
  const service = new IdentityService({ store, config, provider: null, now: () => at, randomId: () => "" });
  const wrong = (await store.apply(row, { reviewState: "approved", levelName: "other" }, event, at))!;
  expect((await service.getIdentityApproval(customerId)).approved).toBe(false);
  const right = (await store.apply(wrong, { levelName: "home-level", approvedAt: at }, event, at))!;
  expect(await service.getIdentityApproval(customerId)).toEqual({ approved: true, level: "home-level", approvedAt: at });
  await store.apply(right, { lifecycle: "deactivated" }, event, at);
  expect((await service.getIdentityApproval(customerId)).approved).toBe(false);
});
