import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  showSmallBalancesPreferenceKey,
  useShowSmallBalances,
} from "./use-show-small-balances";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("useShowSmallBalances", () => {
  test("reads a persisted preference during the initial render", () => {
    window.localStorage.setItem(showSmallBalancesPreferenceKey, "true");

    function Preference() {
      const [value] = useShowSmallBalances();
      return <output>{String(value)}</output>;
    }

    const view = render(<Preference />);

    expect(view.getByText("true")).toBeTruthy();
  });

  test("updates every subscriber when one setter changes the preference", () => {
    function Preference({ name }: { name: string }) {
      const [value, setValue] = useShowSmallBalances();
      return <button onClick={() => setValue(true)}>{`${name}:${value}`}</button>;
    }

    const view = render(<><Preference name="first" /><Preference name="second" /></>);

    fireEvent.click(view.getByRole("button", { name: "first:false" }));

    expect(view.getByRole("button", { name: "first:true" })).toBeTruthy();
    expect(view.getByRole("button", { name: "second:true" })).toBeTruthy();
  });
});
