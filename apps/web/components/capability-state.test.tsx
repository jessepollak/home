import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { CapabilityStatePlacement } from "./capability-state";

const { cleanup, fireEvent, render } = await import("@testing-library/react");
const {
  CapabilityState,
  capabilityStateAllowedActions,
  capabilityStateKinds,
  capabilityStateMessageIds,
  isCapabilityActionAllowed,
} = await import("./capability-state");

afterEach(cleanup);

describe("capability state contract", () => {
  test("is closed, complete, and assigns stable semantic message IDs", () => {
    expect(Object.keys(capabilityStateAllowedActions)).toEqual([...capabilityStateKinds]);
    expect(Object.keys(capabilityStateMessageIds)).toEqual([...capabilityStateKinds]);

    const ids = capabilityStateKinds.flatMap((state) => {
      const messages = capabilityStateMessageIds[state];
      return [messages.title, messages.description, ...messages.actions];
    });
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id?.startsWith("capability.state."))).toBe(true);
  });

  test("permits only the action assigned to each semantic state", () => {
    expect(isCapabilityActionAllowed("sign-in-required", "sign-in")).toBe(true);
    expect(isCapabilityActionAllowed("verification-rejected", "retry-verification")).toBe(true);
    expect(isCapabilityActionAllowed("verification-rejected", "resume-verification")).toBe(true);
    expect(isCapabilityActionAllowed("unavailable-in-country", "retry")).toBe(false);
    expect(isCapabilityActionAllowed("configuration-unavailable", "open")).toBe(false);
  });

  test("fails closed without invoking an action that would fabricate availability", () => {
    let actionCalls = 0;
    const view = render(
      <CapabilityState
        capability="Save"
        state="not-yet-in-home"
        placement="detail"
        action={{ kind: "open", onSelect: () => { actionCalls += 1; } }}
      />,
    );

    expect(view.getAllByText("Not yet in Home").length).toBeGreaterThan(0);
    expect(view.queryByRole("button")).toBeNull();
    expect(actionCalls).toBe(0);
  });
});

describe("capability state presentation", () => {
  for (const placement of ["tile", "row", "detail", "account"] satisfies CapabilityStatePlacement[]) {
    test(`renders semantic copy and the allowed recovery action in the ${placement} placement`, () => {
      let retries = 0;
      const view = render(
        <CapabilityState
          capability="Borrow"
          state="temporarily-unavailable"
          placement={placement}
          action={{ kind: "retry", onSelect: () => { retries += 1; } }}
        />,
      );

      expect(view.getAllByText(/Temporarily unavailable/).length).toBeGreaterThan(0);
      expect(view.getAllByText(/Home could not load this feature\. Try again\./).length).toBeGreaterThan(0);
      fireEvent.click(view.getByRole("button", { name: "Retry" }));
      expect(retries).toBe(1);
    });
  }

  test("does not render an action for country ineligibility", () => {
    const view = render(
      <CapabilityState
        capability="Local transfers"
        state="unavailable-in-country"
        placement="row"
      />,
    );

    expect(view.getByText("Not available in your country")).toBeTruthy();
    expect(view.queryByRole("button")).toBeNull();
  });
});
