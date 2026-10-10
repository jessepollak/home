import { cardRevealHandler } from "@/server/cards/reveal-handler";

export const maxDuration = 15;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  return cardRevealHandler(request, id);
}
