import "./dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { OwnerGenerationFence } from "./owner-generation-fence";
import type { SessionFetch, VerifiedAccountSession } from "./session-client";
import { TransferExecutionError } from "@/shared/transfers/types";

const { render } = await import("@testing-library/react");
const { createElement, useEffect } = await import("react");
const { useAuthenticatedTransport } = await import("./cdp-authenticated-transport");
const { DeploymentExpiredError } = await import("@/client/query/deployment-headers");

const previousDeploymentId = process.env.NEXT_DEPLOYMENT_ID;
const session: VerifiedAccountSession = {
  user: { subject: "subject" },
  smartAccount: {
    address: "0x1111111111111111111111111111111111111111",
    chainId: 8453,
  },
  accountProvider: "base-account",
};
const ownerFence: OwnerGenerationFence = {
  advance: () => 0,
  capture: () => 0,
  isCurrent: (identity) => identity === 0,
  assertCurrent: () => {},
  updateAuthorizationBoundary: () => {},
  updateOwnerKey: () => {},
};

afterEach(() => {
  if (previousDeploymentId === undefined) delete process.env.NEXT_DEPLOYMENT_ID;
  else process.env.NEXT_DEPLOYMENT_ID = previousDeploymentId;
});

async function transportWith(sessionFetch: SessionFetch) {
  return await new Promise<ReturnType<typeof useAuthenticatedTransport>>((resolve) => {
    function Probe() {
      const transport = useAuthenticatedTransport({
        session,
        status: "verified",
        ownerKey: "owner",
        ownerFence,
        getAccessToken: async () => null,
        sessionFetch,
        authentication: "native-base",
      });
      useEffect(() => resolve(transport), [transport]);
      return null;
    }

    render(createElement(Probe));
  });
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return await promise.then(
    () => { throw new Error("Expected promise to reject."); },
    (error: unknown) => error,
  );
}

describe("authenticated transport deployment expiry", () => {
  test("preserves a Home 404 error envelope when a deployment header is sent", async () => {
    process.env.NEXT_DEPLOYMENT_ID = "dpl_current";
    const transport = await transportWith(async (_input, init) => {
      expect(new Headers(init?.headers).get("x-deployment-id")).toBe("dpl_current");
      return Response.json(
        { error: { code: "ACTION_NOT_FOUND", message: "Action not found." } },
        { status: 404 },
      );
    });

    const error = await rejectionOf(
      transport.fetchAccountResource("/api/actions/missing/confirm", {
        method: "POST",
        body: {},
      }),
    );

    expect(error).toBeInstanceOf(TransferExecutionError);
    expect(error).toMatchObject({
      status: 404,
      code: "ACTION_NOT_FOUND",
      serverMessage: "Action not found.",
    });
  });

  test("classifies an envelope-less pinned 404 as an expired deployment", async () => {
    process.env.NEXT_DEPLOYMENT_ID = "dpl_expired";
    const transport = await transportWith(async (_input, init) => {
      expect(new Headers(init?.headers).get("x-deployment-id")).toBe("dpl_expired");
      return new Response("Not Found", { status: 404 });
    });

    const error = await rejectionOf(
      transport.fetchAccountResource("/api/actions/missing/confirm", {
        method: "POST",
        body: {},
      }),
    );

    expect(error).toBeInstanceOf(DeploymentExpiredError);
  });

  test("preserves an envelope-less 404 when no deployment header is sent", async () => {
    delete process.env.NEXT_DEPLOYMENT_ID;
    const transport = await transportWith(async (_input, init) => {
      expect(new Headers(init?.headers).get("x-deployment-id")).toBeNull();
      return new Response("Not Found", { status: 404 });
    });

    const error = await rejectionOf(
      transport.fetchAccountResource("/api/actions/missing/confirm", {
        method: "POST",
        body: {},
      }),
    );

    expect(error).toBeInstanceOf(TransferExecutionError);
    expect(error).toMatchObject({ status: 404, code: null, serverMessage: null });
  });
});
