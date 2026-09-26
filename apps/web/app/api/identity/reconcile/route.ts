import { createHash, timingSafeEqual } from "node:crypto";
import { getIdentityService } from "@/server/identity/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.IDENTITY_RECONCILE_SECRET;
  if (!secret || !/^[\x21-\x7e]{32,512}$/.test(secret)) return Response.json({ ok: false }, { status: 503 });
  const authorization = request.headers.get("authorization") ?? "";
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  const received = createHash("sha256").update(authorization).digest();
  if (!timingSafeEqual(received, expected)) return Response.json({ ok: false }, { status: 401 });
  try {
    const counts = await getIdentityService().reconcileStale(50);
    return Response.json(counts, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ ok: false }, { status: 503 }); }
}
