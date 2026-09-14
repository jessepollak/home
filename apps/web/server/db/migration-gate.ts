import "server-only";

export type MigrationGateDecision =
  | { run: true }
  | { run: false; reason: "database-unset" | "non-production-vercel" };

export function migrationGateDecision(
  env: Readonly<Record<string, string | undefined>>,
): MigrationGateDecision {
  if (!env.DATABASE_URL?.trim()) {
    return { run: false, reason: "database-unset" };
  }
  const vercelEnvironment = env.VERCEL_ENV?.trim();
  if (
    vercelEnvironment &&
    vercelEnvironment !== "production" &&
    env.HOME_MIGRATE_ON_BUILD?.trim() !== "1"
  ) {
    return { run: false, reason: "non-production-vercel" };
  }
  return { run: true };
}
