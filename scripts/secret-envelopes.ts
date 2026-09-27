import { createRuntimeFundingProviderUserTokenStore } from "../apps/web/server/funding/core/user-token-store";
import { rotateUserTokens, verifyUserTokens } from "../apps/web/server/funding/core/user-token-rotation";
import { resolveSecretKeyring } from "../apps/web/server/secrets/at-rest";
import { getSqlExecutor } from "../apps/web/server/db/sql";
import { PostgresWebhookSubscriptionStore } from "../apps/web/server/balances/webhook-subscription-store";
import { rotateWebhookSecrets, verifyWebhookSecrets } from "../apps/web/server/balances/webhook-secret-rotation";

const [action, ...args] = process.argv.slice(2);
const store = createRuntimeFundingProviderUserTokenStore();
try {
  if (action === "delete") {
    const options = new Map<string, string>();
    for (let i = 0; i < args.length; i += 2) {
      if (!args[i]?.startsWith("--") || args[i + 1] === undefined) throw new Error("invalid arguments");
      options.set(args[i]!.slice(2), args[i + 1]!);
    }
    if (options.size !== 5 || [...options.keys()].some((key) => !["account-provider", "subject", "provider", "region", "sandbox"].includes(key)) || !["true", "false"].includes(options.get("sandbox") ?? "")) throw new Error("invalid arguments");
    const deleted = await store.delete({ owner: { accountProvider: options.get("account-provider") as "cdp-embedded" | "base-account", subject: options.get("subject")! }, providerId: options.get("provider")!, region: options.get("region")!, sandbox: options.get("sandbox") === "true" });
    console.log(`deleted=${deleted}`);
  } else if (action === "delete-webhook-subscription" && args.length === 2 && args[0] === "--subscription-id" && args[1]) {
    const webhookStore = new PostgresWebhookSubscriptionStore(getSqlExecutor(), null);
    console.log(`deleted=${await webhookStore.delete(args[1])}`);
  } else if ((action === "rotate" || action === "verify") && args.length === 0) {
    const resolved = resolveSecretKeyring(process.env);
    if (!resolved.ok) throw new Error("keyring unavailable");
    const webhookStore = new PostgresWebhookSubscriptionStore(getSqlExecutor(), resolved.keyring);
    if (action === "rotate") {
      const counts = await rotateUserTokens(store, resolved.keyring, () => new Date());
      console.log(`rotated=${counts.rotated} unreadable=${counts.unreadable} skipped-concurrent=${counts.skippedConcurrent}`);
      const webhookCounts = await rotateWebhookSecrets(webhookStore, resolved.keyring);
      console.log(`webhook-subscriptions sealed-legacy=${webhookCounts.sealedLegacy} rotated=${webhookCounts.rotated} unreadable=${webhookCounts.unreadable} skipped-concurrent=${webhookCounts.skippedConcurrent}`);
    } else {
      const counts = await verifyUserTokens(store, resolved.keyring);
      console.log(`not-at-active=${counts.notAtActive} unreadable=${counts.unreadable}`);
      const webhookCounts = await verifyWebhookSecrets(webhookStore, resolved.keyring);
      console.log(`webhook-subscriptions plaintext=${webhookCounts.plaintext} not-at-active=${webhookCounts.notAtActive} unreadable=${webhookCounts.unreadable}`);
      if (!counts.safeToRemovePrevious || !webhookCounts.safeToRemovePrevious) process.exitCode = 1;
    }
  } else throw new Error("invalid arguments");
} catch {
  console.error("secret envelopes operation failed");
  process.exitCode = 1;
} finally {
  await getSqlExecutor().dispose?.();
}
