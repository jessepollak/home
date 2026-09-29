import { describe, expect, test } from "bun:test";
import { createCardWriteHandlers } from "./write-handler";
import { parseCardEnrollmentResponse, parseCardWriteError, parseCardWriteResponse } from "@/shared/cards/contract";
import type { VerifiedAccountSession } from "@/shared/account/session-types";

const session: VerifiedAccountSession = { accountProvider: "base-account", user: { subject: "owner" },
  smartAccount: { chainId: 8453, address: "0x1111111111111111111111111111111111111111" } };
const request = (headers: Record<string, string> = {}) => new Request("http://localhost/api/cards", {
  method: "POST", body: "{}", headers: { origin: "http://localhost", "content-type": "application/json", "X-Home-Account-Provider": "base-account", ...headers },
});

describe("card POST route contracts and owner fence", () => {
  test("enrollment/issue/freeze responses parse the shared contract", async () => {
    const seen: string[] = [];
    const handlers = createCardWriteHandlers({ authorize: async () => session, customer: async () => ({ id: "owner-id" }),
      service: () => ({ enroll: async (id, redirectUri) => { seen.push(`${id}:${redirectUri}`); return "https://bridge.withpersona.com/inquiry?inquiry-id=inq_test"; },
        issue: async (id) => { seen.push(id); return { id: "ic_123", status: "active" as const }; }, freeze: async (id) => { seen.push(id); return "ic_123"; } }) });
    const enroll = await handlers.enrollment(request());
    expect(parseCardEnrollmentResponse(await enroll.json())?.kycUrl).toContain("bridge.withpersona.com");
    expect(enroll.headers.get("cache-control")).toContain("no-store");
    expect(parseCardWriteResponse(await (await handlers.issue(request())).json())?.card.status).toBe("active");
    expect(parseCardWriteResponse(await (await handlers.freeze(request(), "ic_123", true)).json())?.card.status).toBe("frozen");
    expect(seen).toEqual(["owner-id:http://localhost/card?return=verification", "owner-id", "owner-id"]);
    const forwarded = request({ "x-forwarded-host": "attacker.example", "x-forwarded-proto": "https" });
    expect((await handlers.enrollment(forwarded)).status).toBe(200);
    expect(seen.at(-1)).toBe("owner-id:http://localhost/card?return=verification");
  });
  test("no provider calls without auth, owner, same-origin JSON, or valid card ID", async () => {
    let writes = 0;
    const deps = { customer: async () => ({ id: "owner-id" }), service: () => ({ enroll: async () => { writes++; return "https://bridge.withpersona.com/inquiry"; },
      issue: async () => { writes++; return { id: "ic_123", status: "active" as const }; }, freeze: async () => { writes++; return "ic_123"; } }) };
    const unauthorized = createCardWriteHandlers({ ...deps, authorize: async () => Response.json({}, { status: 401 }) });
    expect((await unauthorized.enrollment(request())).status).toBe(401);
    const missing = createCardWriteHandlers({ ...deps, authorize: async () => session, customer: async () => null });
    expect(parseCardWriteError(await (await missing.issue(request())).json())?.error.code).toBe("CARDS_UNAVAILABLE");
    const handlers = createCardWriteHandlers({ ...deps, authorize: async () => session });
    for (const headers of [{ origin: "https://evil.test" }, { "sec-fetch-site": "cross-site" }, { "content-type": "text/plain" }] as Record<string, string>[]) {
      const result = await handlers.issue(request(headers));
      expect(parseCardWriteError(await result.json())).not.toBeNull();
    }
    const result = await handlers.freeze(request(), "other", false);
    expect(parseCardWriteError(await result.json())?.error.code).toBe("CARD_NOT_FOUND");
    expect(writes).toBe(0);
  });
});
