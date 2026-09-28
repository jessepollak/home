import { handleSumsubWebhook } from "@/server/identity/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> { return handleSumsubWebhook(request); }
