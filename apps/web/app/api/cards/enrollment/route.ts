import { cardWriteHandlers } from "@/server/cards/write-handler";

export const runtime = "nodejs";
export const maxDuration = 15;
export const dynamic = "force-dynamic";
export const POST = cardWriteHandlers.enrollment;
