import { createRuntimeFundingProviderUserTokenStore } from "../apps/web/server/funding/core/user-token-store";
import { rotateUserTokens, verifyUserTokens } from "../apps/web/server/funding/core/user-token-rotation";
import { resolveSecretKeyring } from "../apps/web/server/secrets/at-rest";
import { getSqlExecutor } from "../apps/web/server/db/sql";

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
  } else if ((action === "rotate" || action === "verify") && args.length === 0) {
    const resolved = resolveSecretKeyring(process.env);
    if (!resolved.ok) throw new Error("keyring unavailable");
    if (action === "rotate") {
      const counts = await rotateUserTokens(store, resolved.keyring, () => new Date());
      console.log(`rotated=${counts.rotated} unreadable=${counts.unreadable} skipped-concurrent=${counts.skippedConcurrent}`);
    } else {
      const counts = await verifyUserTokens(store, resolved.keyring);
      console.log(`not-at-active=${counts.notAtActive} unreadable=${counts.unreadable}`);
      if (!counts.safeToRemovePrevious) process.exitCode = 1;
    }
  } else throw new Error("invalid arguments");
} catch {
  console.error("secret envelopes operation failed");
  process.exitCode = 1;
} finally {
  await getSqlExecutor().dispose?.();
}
