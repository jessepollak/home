import { cardWriteHandlers } from "@/server/cards/write-handler";

export const maxDuration = 15;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  return cardWriteHandlers.freeze(request, id, false);
}
