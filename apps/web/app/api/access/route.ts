import { createAccessLoginHandler } from "@/server/access/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createAccessLoginHandler();
