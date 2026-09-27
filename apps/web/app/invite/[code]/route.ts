import { createInviteLandingHandler } from "@/server/invites/landing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createInviteLandingHandler();
export const HEAD = GET;
