import { describe, expect, test } from "bun:test";
import { automationEnvironmentError, composeAllowedDomains, hostObservationRefusal, outputInsideRepository, unexpectedNetworkHosts } from "./live";

describe("session host and environment fences", () => {
  test("composes strict hostnames without widening to parent domains", () => {
    expect(composeAllowedDomains(new URL("https://home.test"), ["api.cdp.coinbase.com"], false)).toContain("home.test");
    expect(() => composeAllowedDomains(new URL("https://home.test"), ["*.example.com"], false)).toThrow("bare hostname");
    expect(composeAllowedDomains(new URL("http://localhost:3200"), [], true)).toContain("127.0.0.1");
  });
  test("detects unapproved network hosts", () => {
    const hosts = unexpectedNetworkHosts(["https://home.test/page", "https://unlisted.test/logo"], ["home.test"]);
    expect(hosts).toEqual(["unlisted.test"]);
    expect(hostObservationRefusal(hosts)).toContain("unlisted.test");
    expect(hostObservationRefusal([])).toBeNull();
  });
  test("refuses CI and evidence output inside the repository", () => {
    expect(automationEnvironmentError({ CI: "1" })).toContain("cannot run in CI");
    expect(outputInsideRepository("/repo/.verify", "/repo")).toBe(true);
    expect(outputInsideRepository("/tmp/verify", "/repo")).toBe(false);
  });
});
