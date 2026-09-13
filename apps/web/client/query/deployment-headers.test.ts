import { describe, expect, test } from "bun:test";
import {
  DeploymentExpiredError,
  deploymentHeaders,
  throwIfDeploymentExpired,
} from "./deployment-headers";

describe("deployment headers", () => {
  test("includes only a defined, non-empty deployment ID", () => {
    const previous = process.env.NEXT_DEPLOYMENT_ID;
    try {
      process.env.NEXT_DEPLOYMENT_ID = "dpl_current";
      expect(deploymentHeaders()).toEqual({ "x-deployment-id": "dpl_current" });

      delete process.env.NEXT_DEPLOYMENT_ID;
      expect(deploymentHeaders()).toEqual({});

      process.env.NEXT_DEPLOYMENT_ID = "";
      expect(deploymentHeaders()).toEqual({});
      expect(deploymentHeaders(false)).toEqual({});
    } finally {
      if (previous === undefined) delete process.env.NEXT_DEPLOYMENT_ID;
      else process.env.NEXT_DEPLOYMENT_ID = previous;
    }
  });

  test("distinguishes a missing pinned deployment", () => {
    expect(() =>
      throwIfDeploymentExpired(
        { status: 404 },
        { "x-deployment-id": "dpl_expired" },
        null,
      )
    ).toThrow(DeploymentExpiredError);
  });
});
