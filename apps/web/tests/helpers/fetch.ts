export function fixtureFetch(implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): typeof fetch {
  return Object.assign(implementation, { preconnect: fetch.preconnect });
}
