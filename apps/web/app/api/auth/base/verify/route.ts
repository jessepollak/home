import { bestEffortCustomerRecord, resolveCustomer } from "@/server/customers/resolve";
import { readRequestIsoCountry } from "@/server/region/request-country";
import { createNativeBaseVerifyHandler } from "@/server/auth/native-base-session";
import { inviteVerifiedCookies, recordVerifiedCustomer } from "@/server/invites/consumption";

export const POST = createNativeBaseVerifyHandler({
  verifiedCookies: inviteVerifiedCookies,
  onVerified: (session, { request }) => {
    const country = readRequestIsoCountry(request.headers);
    return recordVerifiedCustomer(request,
      (inviteCode) => resolveCustomer(session, { create: true, country, inviteCode, at: new Date() }),
      bestEffortCustomerRecord);
  },
});
