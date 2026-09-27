import "@/client/account/dom-test-harness";

import { afterEach, expect, mock, test } from "bun:test";
import { moneySheetIntent } from "./intent-preload";

const { cleanup, fireEvent, render } = await import("@testing-library/react");

afterEach(cleanup);

test("pointer down and focus preload without suppressing repeated intents", () => {
  const preload = mock(() => Promise.resolve());
  const prefetch = mock(() => undefined);
  const view = render(<button type="button" {...moneySheetIntent(preload, prefetch)}>Add money</button>);
  const button = view.getByRole("button", { name: "Add money" });
  fireEvent.pointerDown(button);
  fireEvent.focus(button);
  expect(preload).toHaveBeenCalledTimes(2);
  expect(prefetch).toHaveBeenCalledTimes(2);
});
