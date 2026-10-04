import { describe, expect, test } from "bun:test";
import { migrationGateDecision } from "./migration-gate";

describe("migration build gate", () => {
  test("skips successfully without a database", () => {
    expect(migrationGateDecision({})).toEqual({
      run: false,
      reason: "database-unset",
    });
  });

  test.each(["preview", "development"])(
    "skips a %s Vercel build that shares production persistence",
    (VERCEL_ENV) => {
      expect(migrationGateDecision({ DATABASE_URL: "postgres://db", VERCEL_ENV }))
        .toEqual({ run: false, reason: "non-production-vercel" });
    },
  );

  test("allows production, local, and explicit non-production migrations", () => {
    expect(migrationGateDecision({ DATABASE_URL: "postgres://db", VERCEL_ENV: "production" }))
      .toEqual({ run: true });
    expect(migrationGateDecision({ DATABASE_URL: "postgres://db" }))
      .toEqual({ run: true });
    expect(migrationGateDecision({
      DATABASE_URL: "postgres://db",
      VERCEL_ENV: "preview",
      HOME_MIGRATE_ON_BUILD: "1",
    })).toEqual({ run: true });
  });
});
