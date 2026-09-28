import { createPublicClient, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { toCoinbaseSmartAccount } from "viem/account-abstraction";
import { base } from "viem/chains";
import { createImmersveClient } from "../server/cards/immersve-client";

const origin = "https://test.immersve.com";
const allowedOrigin = "http://localhost:3000";
const id = /^[a-fA-F0-9]{32}$/;
const apiKey = process.env.IMMERSVE_PROBE_API_KEY;
const apiSecret = process.env.IMMERSVE_PROBE_API_SECRET;
const partnerAccountId = process.env.IMMERSVE_PROBE_PARTNER_ACCOUNT_ID;
const clientApplicationId = process.env.IMMERSVE_PROBE_CLIENT_APPLICATION_ID;
if (!apiKey || !apiSecret || !partnerAccountId || !id.test(partnerAccountId) || !clientApplicationId || !id.test(clientApplicationId)) {
  throw new Error("Synthetic sandbox probe requires IMMERSVE_PROBE_API_KEY, IMMERSVE_PROBE_API_SECRET, IMMERSVE_PROBE_PARTNER_ACCOUNT_ID, IMMERSVE_PROBE_CLIENT_APPLICATION_ID");
}

const client = createImmersveClient({ origin, apiKey, apiSecret });
try {
  await client.getSupportedRegions(partnerAccountId);
  console.log("supported-regions: HTTP 200 errorCode=none");
} catch (error) {
  const status = error instanceof Error ? /^Immersve response status (\d{3})$/.exec(error.message)?.[1] : undefined;
  console.log(`supported-regions: HTTP ${status ?? "transport-failure"} errorCode=unavailable`);
}

const owner = privateKeyToAccount(generatePrivateKey());
const publicClient = createPublicClient({ chain: base, transport: http("https://mainnet.base.org", { timeout: 6_000 }) });
try {
  const smartAccount = await toCoinbaseSmartAccount({ client: publicClient, owners: [owner], version: "1.1" });
  const address = await smartAccount.getAddress();
  const deployed = await publicClient.getBytecode({ address });
  if (deployed && deployed !== "0x") throw new Error("Probe smart account unexpectedly deployed");
  await login("counterfactual-smart-account", address, (message) => smartAccount.signMessage({ message }));
} catch {
  console.log("counterfactual-smart-account: HTTP not-run errorCode=local-probe-error");
}
await login("plain-eoa-control", owner.address, (message) => owner.signMessage({ message }));

async function login(label: string, address: `0x${string}`, sign: (message: string) => Promise<string>): Promise<void> {
  try {
    const init = await post("/auth/login-init", {
      loginMethod: "siwe",
      network: "base-mainnet",
      clientApplicationId,
      scopes: ["cardholder-partner"],
      address,
      url: allowedOrigin,
      autoSignup: true,
    });
    if (init.status !== 200 || !object(init.body) || typeof init.body.id !== "string" ||
        !object(init.body.signingChallenge) || typeof init.body.signingChallenge.message !== "string") {
      console.log(`${label} login-init: HTTP ${init.status} errorCode=${errorCode(init.body)}`);
      return;
    }
    console.log(`${label} login-init: HTTP 200 errorCode=none`);
    const signature = await sign(init.body.signingChallenge.message);
    const complete = await post("/auth/login-complete", { loginRequestId: init.body.id, signature });
    console.log(`${label} login-complete: HTTP ${complete.status} errorCode=${complete.status === 200 ? "none" : errorCode(complete.body)}`);
  } catch {
    console.log(`${label}: HTTP transport-failure errorCode=unavailable`);
  }
}

async function post(path: "/auth/login-init" | "/auth/login-complete", body: object): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6_000);
  try {
    const response = await fetch(`${origin}${path}`, {
      method: "POST",
      redirect: "manual",
      signal: controller.signal,
      headers: { origin: allowedOrigin, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (text.length > 32_768) throw new Error("Probe response too large");
    let parsed: unknown;
    try { parsed = JSON.parse(text) as unknown; } catch { parsed = null; }
    return { status: response.status, body: parsed };
  } finally { clearTimeout(timer); }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorCode(value: unknown): string {
  if (!object(value)) return "unavailable";
  const candidate = value.errorCode;
  return typeof candidate === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(candidate) ? candidate : "unavailable";
}
