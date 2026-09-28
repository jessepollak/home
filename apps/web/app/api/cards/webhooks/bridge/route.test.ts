import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { expect, spyOn, test } from "bun:test";
import * as configModule from "@/server/cards/bridge/config";
import * as storeModule from "@/server/cards/store";
import * as sqlModule from "@/server/db/sql";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import { POST } from "./route";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const config = configModule.readBridgeConfig({ BRIDGE_ENABLED: "1", BRIDGE_MODE: "sandbox", BRIDGE_STRIPE_API_VERSION: "2026-08-27.basil", BRIDGE_WEBHOOK_PUBLIC_KEY: publicKey.export({ format: "pem", type: "spki" }).toString(),
  BRIDGE_STRIPE_WEBHOOK_SECRET: "whsec_synthetic_private_fixture", BRIDGE_PROGRAM_SPENDER: "0x65bf8b55EEDef53C094E40003a03390De744DF33" });
if (!config) throw new Error("Fixture config missing");
const request = (body: string, signature?: string) => new Request("https://home.test/api/cards/webhooks/bridge", { method: "POST", body,
  headers: signature ? { "x-webhook-signature": signature } : {} });

test("Bridge route https://apidocs.bridge.xyz/platform/additional-information/webhooks/signature: disabled 202, transient 503", async () => {
  const read = spyOn(configModule, "readBridgeConfig").mockReturnValue(null);
  const logs: string[] = [];
  setObservabilityLogWriterForTests((line) => { logs.push(line); });
  try {
    const disabled = await POST(request("{}"));
    expect(disabled.status).toBe(202);
    expect(await disabled.json()).toEqual({ accepted: false });
    read.mockImplementation(() => { throw new Error("incomplete Bridge config"); });
    expect(await (await POST(request("{}"))).json()).toEqual({ accepted: false });
    read.mockReturnValue(config);
    const body = JSON.stringify({ api_version: "v0", event_id: "wh_route_fixture", event_category: "customer", event_type: "customer.updated", event_object_id: "customer_fixture",
      event_created_at: new Date().toISOString(), event_object: { id: "customer_fixture", name: "PRIVATE" } });
    const timestamp = Date.now();
    const digest = createHash("sha256").update(`${timestamp}.`).update(body).digest();
    const signature = `t=${timestamp},v0=${sign("RSA-SHA256", digest, privateKey).toString("base64")}`;
    let fails = true;
    let inserts = 0;
    const store = spyOn(storeModule, "createCardEventStore").mockReturnValue({ insert: async (event) => {
      inserts++;
      expect(event.externalIds.customer).toBe("customer_fixture");
      if (fails) throw new Error("offline store");
      return true;
    } });
    const sql = spyOn(sqlModule, "getSqlExecutor").mockReturnValue({} as ReturnType<typeof sqlModule.getSqlExecutor>);
    try {
      expect((await POST(request(body, "t=1,v0=invalid"))).status).toBe(202);
      const staleTimestamp = timestamp - 600_001;
      const staleDigest = createHash("sha256").update(`${staleTimestamp}.`).update(body).digest();
      const staleSignature = `t=${staleTimestamp},v0=${sign("RSA-SHA256", staleDigest, privateKey).toString("base64")}`;
      const stale = await POST(request(body, staleSignature));
      expect(stale.status).toBe(400);
      expect(await stale.json()).toEqual({ accepted: false });
      expect(inserts).toBe(0);
      expect((await POST(request(body, signature))).status).toBe(503);
      fails = false;
      const accepted = await POST(request(body, signature));
      expect(accepted.status).toBe(202);
      expect(await accepted.json()).toEqual({ accepted: true });
      expect(logs.map((line) => JSON.parse(line) as { provider?: string; code?: string })).toContainEqual(expect.objectContaining({ provider: "bridge", code: "WEBHOOK_UNAVAILABLE" }));
      expect(logs.map((line) => JSON.parse(line) as { code?: string })).toContainEqual(expect.objectContaining({ code: "WEBHOOK_STALE" }));
      expect(logs.join(" ")).not.toContain("PRIVATE");
    } finally { store.mockRestore(); sql.mockRestore(); }
  } finally { read.mockRestore(); setObservabilityLogWriterForTests(); }
});
