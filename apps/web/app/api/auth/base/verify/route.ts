import { deferCustomerRecord, resolveCustomer } from "@/server/customers/resolve";
import { readRequestIsoCountry } from "@/server/region/request-country";
import { createNativeBaseVerifyHandler } from "@/server/auth/native-base-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createNativeBaseVerifyHandler({
  onVerified: (session, { request }) => {
    const country = readRequestIsoCountry(request.headers);
    void deferCustomerRecord(() => resolveCustomer(session, { create: true, country, at: new Date() }));
  },
});
