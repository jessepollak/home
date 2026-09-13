export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export function jsonFetch(body: unknown, status = 200): typeof fetch {
  return (async () => jsonResponse(body, status)) as unknown as typeof fetch;
}
