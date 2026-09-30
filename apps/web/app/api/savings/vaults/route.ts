import { getMorphoVaultCandidates } from "@/server/morpho";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await getMorphoVaultCandidates();
    return Response.json(result, {
      headers: {
        "Cache-Control": "public, max-age=15, stale-while-revalidate=45",
      },
    });
  } catch {
    return Response.json(
      {
        error: "vault-data-unavailable",
        message: "Current Morpho vault data is unavailable. Try again later.",
      },
      {
        status: 502,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
