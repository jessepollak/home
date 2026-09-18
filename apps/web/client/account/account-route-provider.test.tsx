import "./dom-test-harness";

import { describe, expect, test } from "bun:test";
import { useEffect } from "react";
import { render, waitFor } from "@testing-library/react";
import { AccountProviderForRoute, isAccessRoute } from "./account-route-provider";
import { useAccountWallet } from "./cdp-client";

describe("account provider access-route boundary", () => {
  test("does not mount production account restoration on access routes", async () => {
    let sessionRequests = 0;
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input) === "/api/session") sessionRequests += 1;
      return Response.json({ version: 1, error: { code: "ACCESS_REQUIRED" } }, { status: 401 });
    }) as typeof fetch;

    let observed: { status: string; projectConfigured: boolean } | null = null;
    function Probe() {
      const account = useAccountWallet();
      useEffect(() => {
        observed = {
          status: account.status,
          projectConfigured: account.projectConfigured,
        };
      }, [account]);
      return <p data-next="/borrow?asset=usdc">Access form</p>;
    }

    try {
      const view = render(
        <AccountProviderForRoute
          pathname="/access"
          projectId={null}
          baseAccountEnabled
          smokeFixture={false}
          renderSeed={null}
        >
          <Probe />
        </AccountProviderForRoute>,
      );
      await waitFor(() => expect(observed).not.toBeNull());

      expect(view.getByText("Access form").getAttribute("data-next"))
        .toBe("/borrow?asset=usdc");
      expect(observed as unknown).toEqual({ status: "signed-out", projectConfigured: false });
      expect(sessionRequests).toBe(0);
      expect(isAccessRoute("/access/legacy")).toBe(true);
      expect(isAccessRoute("/account")).toBe(false);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("renders the configured account provider on non-access routes", async () => {
    let observed: { status: string; projectConfigured: boolean } | null = null;
    function Probe() {
      const account = useAccountWallet();
      useEffect(() => {
        observed ??= {
          status: account.status,
          projectConfigured: account.projectConfigured,
        };
      }, [account]);
      return <p>Home account</p>;
    }

    const view = render(
      <AccountProviderForRoute
        pathname="/home"
        projectId="test-project"
        baseAccountEnabled={false}
        smokeFixture={false}
        renderSeed={null}
      >
        <Probe />
      </AccountProviderForRoute>,
    );
    await waitFor(() => expect(observed).not.toBeNull());

    expect(view.getByText("Home account")).toBeTruthy();
    expect(observed as unknown).toEqual({ status: "restoring", projectConfigured: true });
    view.unmount();
  });
});
