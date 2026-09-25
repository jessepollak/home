import "@/client/account/dom-test-harness";

import { afterEach, expect, test } from "bun:test";
import { CircleAlertIcon } from "lucide-react";
import { Button } from "./button";
import { Alert, AlertAction, AlertDescription, AlertIcon } from "./alert";

const { cleanup, render } = await import("@testing-library/react");

afterEach(cleanup);

test("destructive description-only alert exposes its message and retry action without announcing the icon", () => {
  const view = render(
    <Alert variant="destructive">
      <AlertIcon><CircleAlertIcon /></AlertIcon>
      <AlertDescription>Account check unavailable.</AlertDescription>
      <AlertAction><Button variant="outline" size="lg" className="h-11">Retry account check</Button></AlertAction>
    </Alert>
  );

  const alert = view.getByRole("alert");
  expect(alert.textContent).toContain("Account check unavailable.");
  expect(view.getByRole("button", { name: "Retry account check" })).toBeTruthy();
  expect(view.queryByRole("img")).toBeNull();
});

test("action remains reachable when placed before the description", () => {
  const view = render(
    <Alert>
      <AlertAction><Button>Retry</Button></AlertAction>
      <AlertDescription>Vault rates stale.</AlertDescription>
    </Alert>
  );

  expect(view.getByRole("alert").textContent).toContain("Vault rates stale.");
  expect(view.getByRole("button", { name: "Retry" })).toBeTruthy();
});
