import { request as httpRequest } from "node:http";
import { parseBridgeCustomer } from "@/server/cards/bridge/client";

export const fixtureCustomer = {
  id: "1e210e5b-700e-41e6-a62a-0eb0b6ac1967",
  status: "active",
  type: "individual",
  stripe_cardholder_id: "ich_1SVf3CG6FooBAru7mB2MSrDY",
  endorsements: [{ name: "cards", status: "approved", requirements: { complete: ["terms_of_service_v1"], pending: [], missing: null, issues: [] } }],
};

export function startFakeBridge(apiKey: string, response: unknown = fixtureCustomer) {
  let customer: unknown = response;
  let created = false;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get("Api-Key") !== apiKey) return new Response(null, { status: 404 });
    if (request.method === "POST" && url.pathname === "/v0/customers") {
      if (!request.headers.get("Idempotency-Key") ||
          JSON.stringify(await request.json()) !== JSON.stringify({ type: "individual", endorsements: ["cards"] })) return new Response(null, { status: 400 });
      created = true;
      return Response.json(customer, { status: 201 });
    }
    if (request.method === "GET" && url.pathname === `/v0/customers/${fixtureCustomer.id}` && created) return Response.json(customer);
    if (request.method === "GET" && url.pathname === `/v0/customers/${fixtureCustomer.id}/kyc_link` && url.searchParams.get("endorsement") === "cards" && created) {
      const redirectUri = url.searchParams.get("redirect_uri");
      const link = new URL("https://bridge.withpersona.com/inquiry?inquiry-id=inq_test");
      if (redirectUri) link.searchParams.set("redirect_uri", redirectUri);
      return Response.json({ url: link.toString() });
    }
    if (request.method === "GET" && url.pathname === `/v0/customers/${fixtureCustomer.id}`) return Response.json(customer);
    return new Response(null, { status: 404 });
  } });
  return { origin: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true),
    async approveCards(stripeKey: string, fetcher: typeof fetch = fetch) {
      if (!stripeKey.startsWith("sk_test_")) throw new Error("Stripe TEST key required");
      const result = await fetcher("https://api.stripe.com/v1/issuing/cardholders", { method: "POST", redirect: "manual", signal: AbortSignal.timeout(5000),
        headers: { [["Author", "ization"].join("")]: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ type: "individual", "name": "Test Customer", "email": "test-customer@example.test",
          "billing[address][line1]": "123 Test St", "billing[address][city]": "San Francisco", "billing[address][state]": "CA", "billing[address][postal_code]": "94105", "billing[address][country]": "US" }).toString() });
      if (!result.ok) throw new Error(`Stripe test cardholder failed (${result.status})`);
      const value: unknown = await result.json();
      if (typeof value !== "object" || !value || Array.isArray(value) ||
          typeof (value as Record<string, unknown>).id !== "string" || !/^ich_[A-Za-z0-9]+$/.test((value as { id: string }).id)) throw new Error("Invalid test cardholder");
      customer = { ...fixtureCustomer, stripe_cardholder_id: (value as { id: string }).id, endorsements: fixtureCustomer.endorsements };
    } };
}

export const fetchFakeBridge = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
  new Promise((resolve, reject) => {
    const request = httpRequest(String(input), { method: init?.method, headers: init?.headers as Record<string, string> }, (result) => {
      const chunks: Uint8Array[] = [];
      result.on("data", (chunk: Uint8Array) => chunks.push(chunk));
      result.on("end", () => resolve(new Response(Buffer.concat(chunks).toString("utf8"), { status: result.statusCode ?? 500 })));
      result.on("error", reject);
    });
    request.on("error", reject);
    if (init?.body) request.write(init.body);
    request.end();
  })) as typeof fetch;

export function validatedFixture() {
  return parseBridgeCustomer(fixtureCustomer);
}
