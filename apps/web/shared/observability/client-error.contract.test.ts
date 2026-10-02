import { describe, expect, test } from "bun:test";
import { CLIENT_ERROR_CONTRACT_VERSION, parseClientErrorReport } from "./client-error.contract";

const report = { name: "TypeError", message: "boom", route: "/activity" } as const;

describe("client error reports", () => {
  test("round-trips the unversioned beacon and accepts only the additive contract version", () => {
    expect(CLIENT_ERROR_CONTRACT_VERSION).toBe(1);
    expect(parseClientErrorReport(report)).toEqual(report);
    expect(parseClientErrorReport({ ...report, version: 1 })).toEqual(report);
    for (const version of [2, 0, "1", null, undefined]) {
      expect(parseClientErrorReport({ ...report, version })).toBeNull();
    }
  });

  test("returns only sanitized public fields without retaining the version or private values", () => {
    expect(parseClientErrorReport({
      version: 1,
      name: "not a valid identifier",
      message: '  failed with accessToken="synthetic-secret-canary"  ',
      route: "/activity?token=synthetic-route-canary#private-fragment",
    })).toEqual({
      name: "Error",
      message: 'failed with accessToken="[REDACTED]"',
      route: "/activity",
    });
    for (const field of ["token", "owner", "stack", "extra"]) {
      expect(parseClientErrorReport({ ...report, [field]: "private-canary" })).toBeNull();
    }
  });

  test("rejects non-objects and missing, empty, oversized, or non-string required fields", () => {
    for (const value of [null, undefined, [], "report", 1, true, {}]) {
      expect(parseClientErrorReport(value)).toBeNull();
    }
    for (const [field, maximum] of [["name", 80], ["message", 1_024], ["route", 512]] as const) {
      expect(parseClientErrorReport(Object.fromEntries(
        Object.entries(report).filter(([key]) => key !== field),
      ))).toBeNull();
      for (const value of ["", "x".repeat(maximum + 1), null, undefined, 1, true, [], {}]) {
        expect(parseClientErrorReport({ ...report, [field]: value })).toBeNull();
      }
    }
    expect(parseClientErrorReport({ ...report, route: `/${"x".repeat(512)}` })).toBeNull();
  });

  test("accepts exact length limits before sanitizing and caps the sanitized message", () => {
    expect(parseClientErrorReport({ name: "E", message: "m", route: "/" })).toEqual({
      name: "E", message: "m", route: "/",
    });
    expect(parseClientErrorReport({
      name: "E".repeat(80),
      message: "m".repeat(1_024),
      route: `/${"a/".repeat(255)}b`,
    })).toEqual({ name: "Error", message: "m".repeat(256), route: `/${"a/".repeat(255)}b`.slice(0, 192) });
  });

  test("rejects external and relative routes even when embedded in an absolute path", () => {
    for (const route of ["//evil", "https://evil", "relative", "/https://evil"]) {
      expect(parseClientErrorReport({ ...report, route })).toBeNull();
    }
  });

  test("rejects messages that become empty after scrubbing and trimming", () => {
    for (const message of ["   ", "\t\r\n", "\u0000\u0001"]) {
      expect(parseClientErrorReport({ ...report, message })).toBeNull();
    }
  });
});
