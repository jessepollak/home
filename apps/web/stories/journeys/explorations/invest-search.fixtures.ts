import { http, HttpResponse } from "msw";
import { searchFixture } from "@/tests/browser/feature-map/search-fixtures";

export const investSearchHandler = http.get("/api/invest/search", ({ request }) => {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  return query === "unavailable" ? new HttpResponse(null, { status: 503 }) : HttpResponse.json(searchFixture(query));
});
