import { createHmac, generateKeyPairSync } from "node:crypto";
import { expect, spyOn, test } from "bun:test";
import * as configModule from "@/server/cards/bridge/config";
import * as storeModule from "@/server/cards/store";
import * as sqlModule from "@/server/db/sql";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import { POST } from "./route";

const secret = "whsec_synthetic_private_fixture";
const config = configModule.readBridgeConfig({ BRIDGE_ENABLED: "1", BRIDGE_MODE: "sandbox", BRIDGE_WEBHOOK_PUBLIC_KEY: generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ format: "pem", type: "spki" }).toString(),
  BRIDGE_STRIPE_WEBHOOK_SECRET: secret, BRIDGE_PROGRAM_SPENDER: "0x65bf8b55EEDef53C094E40003a03390De744DF33" });
if (!config) throw new Error("Fixture config missing");
const request = (body: string, signature?: string) => new Request("https://home.test/api/cards/webhooks/stripe", { method: "POST", body,
  headers: signature ? { "stripe-signature": signature } : {} });

test("Stripe route https://docs.stripe.com/webhooks: disabled 202, transient 503", async () => {
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
    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ id: "evt_route_fixture", type: "issuing_transaction.created", livemode: false, created: timestamp,
      data: { object: { object: "issuing.transaction", id: "itrx_fixture", card: "ic_fixture", cardholder: "ich_fixture", number: "PRIVATE" } } });
    const signature = `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
    let fails = true;
    const store = spyOn(storeModule, "createCardEventStore").mockReturnValue({ insert: async (event) => {
      expect(event.eventId).toBe("stripe:evt_route_fixture");
      if (fails) throw new Error("offline store");
      return true;
    } });
    const sql = spyOn(sqlModule, "getSqlExecutor").mockReturnValue({} as ReturnType<typeof sqlModule.getSqlExecutor>);
    try {
      expect((await POST(request(body, "t=1,v1=invalid"))).status).toBe(202);
      expect((await POST(request(body, signature))).status).toBe(503);
      fails = false;
      const accepted = await POST(request(body, signature));
      expect(accepted.status).toBe(202);
      expect(await accepted.json()).toEqual({ accepted: true });
      expect(logs.map((line) => JSON.parse(line) as { provider?: string; code?: string })).toContainEqual(expect.objectContaining({ provider: "bridge", code: "WEBHOOK_UNAVAILABLE" }));
      expect(logs.join(" ")).not.toContain("PRIVATE");
    } finally { store.mockRestore(); sql.mockRestore(); }
  } finally { read.mockRestore(); setObservabilityLogWriterForTests(); }
});
