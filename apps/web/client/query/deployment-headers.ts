export class DeploymentExpiredError extends Error {
  constructor() {
    super("Reload to update.");
    this.name = "DeploymentExpiredError";
  }
}

export function deploymentHeaders(
  id: unknown = process.env.NEXT_DEPLOYMENT_ID,
): Record<string, string> {
  return typeof id === "string" && id.length > 0
    ? { "x-deployment-id": id }
    : {};
}

export function throwIfDeploymentExpired(
  response: Pick<Response, "status">,
  headers: Record<string, string>,
  errorCode: string | null,
): void {
  if (
    response.status === 404 &&
    headers["x-deployment-id"] &&
    errorCode === null
  ) {
    throw new DeploymentExpiredError();
  }
}
