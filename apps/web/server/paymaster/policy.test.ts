import { describe, expect, test } from "bun:test";
import { ACCOUNT_PROVIDER_HEADER, type AccountProvider, type VerifiedAccountSession } from "@/shared/account/session-types";
import { createNetworkFeePolicyHandler } from "./policy";
import { getPaymasterUrl } from "./config";

const address = "0x1111111111111111111111111111111111111111" as const;
const request = (provider: AccountProvider = "cdp-embedded") => new Request("https://home.test/api/actions/network-fee", { headers: { [ACCOUNT_PROVIDER_HEADER]: provider } });
const authorizeFor = (accountProvider: AccountProvider, smartAccount: VerifiedAccountSession["smartAccount"] = { address, chainId: 8453 }) => async () => Response.json({ user: { subject: "fee-test" }, smartAccount, accountProvider });
const authorize = authorizeFor("cdp-embedded");

describe("network fee policy route", () => {
  test.each([[true, "100000"], [false, null]] as const)("enabled=%s returns reserve %s", async (enabled, reserve) => {
    const response = await createNetworkFeePolicyHandler({ authorize, enabled: () => enabled, readCode: async () => {
      if (!enabled) throw new Error("unexpected code read");
      return "0x60806040";
    } })(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: 1, usdcReserveBaseUnits: reserve });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  test("undeployed base-account has no USDC reserve", async () => {
    const input = request("base-account");
    const response = await createNetworkFeePolicyHandler({
      authorize: authorizeFor("base-account"),
      enabled: () => true,
      readCode: async (account, signal) => {
        expect(account).toBe(address);
        expect(signal).toBe(input.signal);
        return "0x";
      },
    })(input);
    expect(await response.json()).toEqual({ version: 1, usdcReserveBaseUnits: null });
  });

  test.each([["0x60806040", "100000"], ["not-hex", "500000"], ["0x123", "500000"]] as const)("base-account code %s returns reserve %s", async (code, reserve) => {
    const response = await createNetworkFeePolicyHandler({ authorize: authorizeFor("base-account"), enabled: () => true, readCode: async () => code })(request("base-account"));
    expect(await response.json()).toEqual({ version: 1, usdcReserveBaseUnits: reserve });
  });

  test.each(["async", "sync"] as const)("base-account %s code read failure uses the undeployed reserve", async failure => {
    const readCode = () => { throw new Error("RPC unavailable"); };
    const response = await createNetworkFeePolicyHandler({ authorize: authorizeFor("base-account"), enabled: () => true, readCode: failure === "async" ? async () => readCode() : readCode })(request("base-account"));
    expect(await response.json()).toEqual({ version: 1, usdcReserveBaseUnits: "500000" });
  });

  test.each([["0x60806040", "100000"], ["0x", "500000"], ["not-hex", "500000"]] as const)("cdp-embedded code %s returns reserve %s", async (code, reserve) => {
    let reads = 0;
    const input = request();
    const response = await createNetworkFeePolicyHandler({ authorize, enabled: () => true, readCode: async (account, signal) => {
      expect(account).toBe(address);
      expect(signal).toBe(input.signal);
      reads++;
      return code;
    } })(input);
    expect(reads).toBe(1);
    expect(await response.json()).toEqual({ version: 1, usdcReserveBaseUnits: reserve });
  });

  test("cdp-embedded code read failure uses the undeployed reserve", async () => {
    const response = await createNetworkFeePolicyHandler({ authorize, enabled: () => true, readCode: async () => { throw new Error("RPC unavailable"); } })(request());
    expect(await response.json()).toEqual({ version: 1, usdcReserveBaseUnits: "500000" });
  });

  test("sessions without a smart account have no USDC reserve", async () => {
    let reads = 0;
    const response = await createNetworkFeePolicyHandler({ authorize: authorizeFor("cdp-embedded", null), enabled: () => true, readCode: async () => { reads++; return "0x"; } })(request());
    expect(reads).toBe(0);
    expect(await response.json()).toEqual({ version: 1, usdcReserveBaseUnits: null });
  });

  test.each(["base-account", "cdp-embedded"] as const)("disabled paymaster does not read %s code", async provider => {
    let reads = 0;
    const response = await createNetworkFeePolicyHandler({ authorize: authorizeFor(provider), enabled: () => false, readCode: async () => { reads++; return "0x"; } })(request(provider));
    expect(reads).toBe(0);
    expect(await response.json()).toEqual({ version: 1, usdcReserveBaseUnits: null });
  });

  test("only server-side HTTPS paymaster URLs enable the feature", () => {
    expect(getPaymasterUrl("")).toBeNull();
    expect(getPaymasterUrl("http://fees.example/key")).toBeNull();
    expect(getPaymasterUrl("https://fees.example/key")).toBe("https://fees.example/key");
  });

  test("unauthenticated users cannot query the policy", async () => {
    const response = await createNetworkFeePolicyHandler({ authorize: async () => Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in." } }, { status: 401 }) })(request());
    expect(response.status).toBe(401);
  });
});
