import { cardSpendingHandler } from "@/server/cards/allowance/spending";

export const runtime = "nodejs";
export const maxDuration = 15;
export const dynamic = "force-dynamic";
export const GET = cardSpendingHandler;
