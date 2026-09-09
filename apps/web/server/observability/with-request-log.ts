import { writeStructuredLog, readLoggedAccountProvider } from "./log";

type RouteHandler<A extends unknown[]> = (
  request: Request,
  ...args: A
) => Response | Promise<Response>;

export async function readResponseErrorCode(
  response: Response,
): Promise<string | undefined> {
  if (response.status < 400) {
    return undefined;
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return undefined;
  }
  try {
    const body: unknown = await response.clone().json();
    if (
      body &&
      typeof body === "object" &&
      "error" in body &&
      body.error &&
      typeof body.error === "object" &&
      "code" in body.error &&
      typeof body.error.code === "string"
    ) {
      return body.error.code;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function withRequestLog<A extends unknown[]>(
  route: string,
  handler: RouteHandler<A>,
): RouteHandler<A> {
  return async (request, ...args) => {
    const accountProvider = readLoggedAccountProvider(request);
    try {
      const response = await handler(request, ...args);
      writeStructuredLog({
        kind: "request",
        route,
        status: response.status,
        errorCode: await readResponseErrorCode(response),
        accountProvider,
      });
      return response;
    } catch (error) {
      writeStructuredLog({
        kind: "unhandled-server-error",
        route,
        status: 500,
        errorCode: "UNHANDLED",
        accountProvider,
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : "unhandled",
      });
      throw error;
    }
  };
}
