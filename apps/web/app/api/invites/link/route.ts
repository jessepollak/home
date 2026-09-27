import { createInviteLinkHandler } from "@/server/invites/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createInviteLinkHandler();
