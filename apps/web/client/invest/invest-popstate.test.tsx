import "@/client/account/dom-test-harness";
import { afterEach, expect, test } from "bun:test";
import { useEffect, useState } from "react";
import { page } from "@/tests/helpers/dom";
import { getHomeQueryClient } from "@/client/query/query-client";
import { parseShellLocation } from "@/config/shell-location";
import { HomeShellRoutingProvider, readHomeInboundPanelState, type HomeShellRouting } from "@/client/home/panel-routing";

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { InvestExperience } = await import("./invest-experience");

function RoutingFixture() {
  const [popRevision, setPopRevision] = useState(0);
  useEffect(() => {
    const onPop = () => setPopRevision((revision) => revision + 1);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const routing: HomeShellRouting = {
    state: readHomeInboundPanelState(parseShellLocation(window.location.pathname), new URLSearchParams(window.location.search)),
    popRevision,
    activityReturn: null,
    rootRequest: null,
    pushRoute: () => {},
    leaveRoute: () => {},
    openPanel: () => {},
    canOpenAssetDetail: () => false,
    openAssetDetail: () => false,
    setFlow: () => false,
    clearFlow: () => {},
  };
  return <HomeShellRoutingProvider value={routing}><InvestExperience /></HomeShellRoutingProvider>;
}

function navigate(href: string, state: Record<string, unknown>) {
  act(() => {
    window.history.replaceState(state, "", href);
    window.dispatchEvent(new PopStateEvent("popstate", { state }));
  });
}

afterEach(() => {
  cleanup();
  getHomeQueryClient().clear();
  window.history.replaceState(null, "", "/invest");
});

test("browser back and forward restore Invest's query, view, and detail origin", () => {
  window.history.replaceState({ investSearchQuery: "saved" }, "", "/invest");
  render(<RoutingFixture />);
  expect((page().getByRole("textbox", { name: "Search assets" }) as HTMLInputElement).value).toBe("saved");

  navigate("/invest/crypto", { investSearchQuery: "saved" });
  expect(page().getByRole("button", { name: "Back to Invest" })).toBeTruthy();

  navigate("/invest/cbbtc", { investSearchQuery: "saved", investDetailFrom: "crypto" });
  expect(page().getByRole("button", { name: "Back" })).toBeTruthy();
  fireEvent.click(page().getByRole("button", { name: "Back" }));
  expect(window.location.pathname).toBe("/invest/crypto");
  expect(page().getByRole("button", { name: "Back to Invest" })).toBeTruthy();

  navigate("/invest", { investSearchQuery: "restored" });
  expect((page().getByRole("textbox", { name: "Search assets" }) as HTMLInputElement).value).toBe("restored");
  fireEvent.change(page().getByRole("textbox", { name: "Search assets" }), { target: { value: "edited" } });
  expect((page().getByRole("textbox", { name: "Search assets" }) as HTMLInputElement).value).toBe("edited");

  navigate("/invest/cbbtc", { investSearchQuery: "restored", investDetailFrom: "hub" });
  fireEvent.click(page().getByRole("button", { name: "Back" }));
  expect(window.location.pathname).toBe("/invest");
  expect((page().getByRole("textbox", { name: "Search assets" }) as HTMLInputElement).value).toBe("restored");
});
