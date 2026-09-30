import { createCustomerSupportHandoffHandler } from "@/server/support/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createCustomerSupportHandoffHandler();
