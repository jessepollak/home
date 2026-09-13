export class DeploymentExpiredError extends Error {
  constructor() {
    super("Reload to update.");
    this.name = "DeploymentExpiredError";
  }
}

export function deploymentHeaders(): Record<string, string> {
  const id = process.env.NEXT_DEPLOYMENT_ID;
  return typeof id === "string" && id.length > 0
    ? { "x-deployment-id": id }
    : {};
}

export function throwIfDeploymentExpired(
  response: Pick<Response, "status">,
  headers: Record<string, string>,
): void {
  if (response.status === 404 && headers["x-deployment-id"]) {
    throw new DeploymentExpiredError();
  }
}
