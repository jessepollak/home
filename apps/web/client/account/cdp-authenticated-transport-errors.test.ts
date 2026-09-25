import "./dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { OwnerGenerationFence } from "./owner-generation-fence";
import type { AccessNavigation } from "./access-response";
import type { SessionFetch, VerifiedAccountSession } from "./session-client";
import { TransferExecutionError } from "@/shared/transfers/types";
import { ResourceFailure, isInterruptionEligible } from "./resource-failure";

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
  updateOwnerKey: () => false,
};

afterEach(() => {
  if (previousDeploymentId === undefined) delete process.env.NEXT_DEPLOYMENT_ID;
  else process.env.NEXT_DEPLOYMENT_ID = previousDeploymentId;
});

async function transportWith(
  sessionFetch: SessionFetch,
  accessNavigation?: AccessNavigation,
  options: {
    verification?: "provisional" | "server";
    status?: "validating" | "verified" | "restoring" | "signing-out" | "signed-out" | "unavailable";
    ownerFence?: OwnerGenerationFence;
  } = {},
) {
  return await new Promise<ReturnType<typeof useAuthenticatedTransport>>((resolve) => {
    function Probe() {
      const transport = useAuthenticatedTransport({
        session,
        status: options.status ?? "verified",
        verification: options.verification ?? "server",
        ownerKey: "owner",
        ownerFence: options.ownerFence ?? ownerFence,
        getAccessToken: async () => null,
        sessionFetch,
        authentication: "native-base",
        accessNavigation,
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

describe("provisional balance transport", () => {
  test("only balances GET crosses the provisional boundary", async () => {
    const requests: string[] = [];
    const transport = await transportWith(async (input, init) => {
      requests.push(`${init?.method} ${String(input)}`);
      return Response.json({ balance: "1" });
    }, undefined, { verification: "provisional", status: "validating" });
    expect(await transport.fetchBalances("US")).toEqual({ balance: "1" });
    expect(await rejectionOf(transport.fetchActivity(""))).toMatchObject({ kind: "session" });
    expect(await rejectionOf(transport.fetchAccountResource("/api/actions")))
      .toMatchObject({ reason: "stale-session" });
    expect(await rejectionOf(transport.fetchAccountResource("/api/balances")))
      .toMatchObject({ reason: "stale-session" });
    expect(await rejectionOf(transport.fetchMoneyActionApi("/api/actions/prepare", { method: "POST", body: "{}" })))
      .toMatchObject({ reason: "stale-session" });
    expect(requests).toEqual(["GET /api/balances?region=US"]);
  });

  test("drops an in-flight provisional response after the owner fence advances", async () => {
    let generation = 0;
    let release!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { release = resolve; });
    const transport = await transportWith(async () => pending, undefined, {
      verification: "provisional", status: "validating",
      ownerFence: { ...ownerFence, capture: () => generation, isCurrent: (value) => value === generation },
    });
    const read = transport.fetchBalances("US");
    await Promise.resolve();
    generation += 1;
    release(Response.json({ balance: "old owner" }));
    expect(await rejectionOf(read)).toMatchObject({ kind: "session" });
  });

  test("rejects seeded restoring and all other non-validating provisional balance reads", async () => {
    const requests: string[] = [];
    for (const status of ["restoring", "signing-out", "signed-out", "unavailable"] as const) {
      const transport = await transportWith(async (input) => {
        requests.push(String(input));
        return Response.json({});
      }, undefined, { verification: "provisional", status });
      expect(await rejectionOf(transport.fetchBalances("US"))).toMatchObject({ kind: "session" });
    }
    expect(requests).toEqual([]);
  });
});

describe("verified read failure tagging", () => {
  test.each([
    ["network", undefined, true], ["http", 500, true], ["http", 503, true],
    ["http", 401, false], ["http", 403, false], ["http", 429, false],
    ["session", undefined, false], ["parse", undefined, false], ["access", undefined, false],
  ] as const)("%s %s eligible=%s", (kind, status, eligible) => {
    expect(isInterruptionEligible(new ResourceFailure(kind, undefined, status))).toBe(eligible);
  });

  test("does not classify untagged failures or aborted reads", async () => {
    expect(isInterruptionEligible(new Error("parse balances"))).toBe(false);
    const abort = new Error("aborted");
    const transport = await transportWith(async () => { throw abort; });
    const controller = new AbortController();
    controller.abort();
    expect(await rejectionOf(transport.fetchBalances("US", controller.signal))).toBe(abort);
  });

  test("tags transport, server and parse failures without changing messages or HTTP details", async () => {
    const network = await transportWith(async () => { throw new Error("socket closed"); });
    expect(await rejectionOf(network.fetchActivity(""))).toMatchObject({
      kind: "network", message: "Authenticated resource is unavailable.",
    });
    const server = await transportWith(async () => Response.json({
      error: { code: "UPSTREAM", message: "try later" },
    }, { status: 503 }));
    expect(await rejectionOf(server.fetchBalances("US"))).toMatchObject({
      kind: "http", status: 503, code: "UPSTREAM", serverMessage: "try later",
    });
    const parsed = await transportWith(async () => new Response("broken json"));
    expect(await rejectionOf(parsed.fetchActivity(""))).toMatchObject({ kind: "parse" });
  });
});

describe("authenticated transport deployment expiry", () => {
  test("routes access expiry before endpoint parsing and preserves the response body", async () => {
    const destinations: string[] = [];
    const responses: Response[] = [];
    const accessNavigation = {
      currentPath: "/private?panel=activity#latest",
      navigate: (destination: string) => destinations.push(destination),
    };
    const transport = await transportWith(async () => {
      const response = Response.json(
        { version: 1, error: { code: "ACCESS_REQUIRED" } },
        { status: 401 },
      );
      responses.push(response);
      return response;
    }, accessNavigation);

    const [balanceError, actionError] = await Promise.all([
      rejectionOf(transport.fetchBalances("US")),
      rejectionOf(transport.fetchAccountResource("/api/actions")),
    ]);
    expect(balanceError).toMatchObject({ kind: "access", message: "Deployment access is required." });
    expect(isInterruptionEligible(balanceError)).toBe(false);
    expect(actionError).toBeInstanceOf(TransferExecutionError);

    expect(destinations).toEqual([
      "/access?next=%2Fprivate%3Fpanel%3Dactivity%23latest",
    ]);
    expect(responses).toHaveLength(2);
    for (const response of responses) {
      expect(response.bodyUsed).toBe(false);
      expect(await response.json()).toEqual({
        version: 1,
        error: { code: "ACCESS_REQUIRED" },
      });
    }
  });

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
