import { deferCustomerRecord, resolveCustomer } from "@/server/customers/resolve";
import { readRequestIsoCountry } from "@/server/region/request-country";
import { issueCdpRenderHint } from "@/server/auth/cdp-render-session";
import { isHomeSessionConfigured } from "@/server/auth/native-base-session";
import { getCdpAccessTokenValidator } from "@/server/cdp/provider";
import { createSessionHandler } from "@/server/cdp/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createSessionHandler({
  getValidator: () => getCdpAccessTokenValidator(),
  baseAccountEnabled: () => isHomeSessionConfigured(process.env.HOME_SESSION_SECRET),
  issueCookies: (session, request) =>
    issueCdpRenderHint(process.env.HOME_SESSION_SECRET, session, request),
  onVerifiedSession: (session, { request, email }) => {
    const country = readRequestIsoCountry(request.headers);
    void deferCustomerRecord(() => resolveCustomer(session, { create: true, email, country, at: new Date() }));
  },
});
