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
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET" || request.headers.get("Api-Key") !== apiKey ||
        url.pathname !== `/v0/customers/${fixtureCustomer.id}`) return new Response(null, { status: 404 });
    return Response.json(response);
  } });
  return { origin: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
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
    request.end();
  })) as typeof fetch;

export function validatedFixture() {
  return parseBridgeCustomer(fixtureCustomer);
}
