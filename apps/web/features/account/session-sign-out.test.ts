import { describe, expect, test } from "bun:test";
import {
  isSessionSuppressedForOwner,
  signOutWithSessionSuppressed,
  type SessionSuppression,
} from "./session-sign-out";

const OWNER_KEY = "sdk-user-a";
const GENERATION = 4;

describe("session sign-out suppression helpers", () => {
  test("suppresses the exact authentication generation before SDK sign-out", async () => {
    const events: string[] = [];
    let suppression: SessionSuppression | null = null;

    const result = await signOutWithSessionSuppressed({
      ownerKey: OWNER_KEY,
      generation: GENERATION,
      suppress: (value) => {
        suppression = value;
        events.push(`suppress:${value.ownerKey}:${value.generation}`);
      },
      signOut: async () => {
        events.push("sign-out");
        throw new Error("fixture failure");
      },
      onFailure: () => events.push("failure"),
    });

    expect(result).toBe(false);
    expect(events).toEqual([
      `suppress:${OWNER_KEY}:${GENERATION}`,
      "sign-out",
      "failure",
    ]);
    expect(
      isSessionSuppressedForOwner(suppression, OWNER_KEY, GENERATION),
    ).toBe(true);
    expect(
      isSessionSuppressedForOwner(suppression, "sdk-user-b", GENERATION),
    ).toBe(false);
    expect(
      isSessionSuppressedForOwner(suppression, OWNER_KEY, GENERATION + 1),
    ).toBe(false);
  });

  test("returns success without invoking the failure callback", async () => {
    let failures = 0;

    const result = await signOutWithSessionSuppressed({
      ownerKey: OWNER_KEY,
      generation: GENERATION,
      suppress: () => {},
      signOut: async () => {},
      onFailure: () => {
        failures += 1;
      },
    });

    expect(result).toBe(true);
    expect(failures).toBe(0);
  });
});
