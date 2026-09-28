import { cardsHandler } from "@/server/cards/handler";
import { cardWriteHandlers } from "@/server/cards/write-handler";

export const runtime = "nodejs";
export const maxDuration = 15;
export const dynamic = "force-dynamic";
export const GET = cardsHandler;
export const POST = cardWriteHandlers.issue;
