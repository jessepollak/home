import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { emitServerEvent } from "@/server/observability/log";

export function emitUnknownFundingOrderRouteFailure(fields: {
  route: "/api/funding/orders" | "/api/funding/orders/:id";
  code: string;
  session: VerifiedAccountSession;
  startedAt: number;
}): void {
  emitServerEvent("funding-order", {
    route: fields.route,
    code: fields.code,
    outcome: "unavailable",
    owner: {
      subject: fields.session.user.subject,
      accountProvider: fields.session.accountProvider,
    },
    durationMs: Date.now() - fields.startedAt,
  });
}
