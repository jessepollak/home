import { sessionHandler } from "@/server/auth/authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = sessionHandler;
