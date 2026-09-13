import { sessionHandler } from "@/server/auth/authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const boundary = await sessionHandler(request);
  if (!boundary.ok) return boundary;
  return Response.json(
    {
      error: {
        code: "HOSTED_SWAP_UNAVAILABLE",
        message: "Hosted swaps are unavailable.",
      },
    },
    {
      status: 503,
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Authorization, X-Home-Account-Provider",
      },
    },
  );
}
