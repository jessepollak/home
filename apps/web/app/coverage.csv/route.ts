import { coverageCsv } from "@/config/coverage";

export function GET() {
  return new Response(coverageCsv(), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="home-local-money-coverage.csv"',
      "cache-control": "public, max-age=3600",
    },
  });
}
