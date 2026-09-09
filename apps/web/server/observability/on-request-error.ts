import { sanitizePathname } from "@/features/observability/scrub";
import { writeStructuredLog } from "./log";

export type RequestErrorInfo = {
  path: string;
  method: string;
  headers: { [key: string]: string | string[] | undefined };
};

export type RequestErrorContext = {
  routePath: string;
  routeType: string;
};

export async function handleRequestError(
  error: unknown,
  request: RequestErrorInfo,
  context: RequestErrorContext,
): Promise<void> {
  writeStructuredLog({
    kind: "unhandled-server-error",
    route: `${request.method} ${sanitizePathname(request.path)}`,
    status: 500,
    errorCode: "UNHANDLED",
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : "unhandled",
    routeType: context.routeType,
  });
}
