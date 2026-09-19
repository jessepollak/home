import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, jest, test } from "bun:test";
import { Button } from "@/components/ui/button";

const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { CardExperience } = await import("./card-experience");
const page = () => within(document.body);

afterEach(() => cleanup());

const issuedState = {
  kind: "issued" as const,
  status: "active" as const,
  form: "virtual" as const,
  walletState: "eligible" as const,
  availableToSpend: "$420.75",
  fundingSource: "Funded from USD Coin",
  allocationLabel: "$420.75 is allocated from your Home balance—not counted twice.",
  serviceStatus: "available" as const,
  controls: [
    { id: "online", label: "Online purchases", description: "Allow online purchases.", enabled: true },
  ],
  limits: [
    { label: "Daily spending limit", value: "$1,000.00", detail: "$579.25 remaining today" },
  ],
  activity: [
    {
      id: "decline-1",
      merchant: "Harbor Grocer",
      occurredAt: "Today, 8:02 AM",
      amount: "$68.20",
      status: "declined" as const,
      statusDetail: "Not charged",
    },
    {
      id: "refund-1",
      merchant: "Northstar Outfitters",
      occurredAt: "Sep 17",
      amount: "+$86.00",
      status: "refunded" as const,
      statusDetail: "Returned to available funds",
    },
  ],
};

describe("CardExperience", () => {
  test("keeps an eligible, not-issued card behind the issuance action", () => {
    const onStartIssuance = jest.fn();
    const onStartVerification = jest.fn();
    render(
      <CardExperience
        state={{ kind: "not-issued", eligibility: "eligible", identityRequirement: { kind: "none" } }}
        onStartIssuance={onStartIssuance}
        onStartVerification={onStartVerification}
      />,
    );

    expect(page().getByRole("heading", { name: "Card" })).toBeTruthy();
    expect(page().getByText("Set up your card")).toBeTruthy();
    expect(page().queryByText("Available to spend")).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Get started" }));
    expect(onStartIssuance).toHaveBeenCalledTimes(1);
    expect(onStartVerification).not.toHaveBeenCalled();
  });

  test("shows provider-hosted verification only when explicitly required", () => {
    const onStartVerification = jest.fn();
    render(
      <CardExperience
        state={{
          kind: "not-issued",
          eligibility: "verification-required",
          identityRequirement: {
            kind: "provider-hosted",
            label: "Complete verification with the card partner.",
          },
        }}
        onStartVerification={onStartVerification}
      />,
    );

    expect(page().getByText("Complete verification with the card partner.")).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Start verification" }));
    expect(onStartVerification).toHaveBeenCalledTimes(1);
  });

  test("composes injected funding and delegates secure, freeze, controls, wallet, and Activity actions", () => {
    const onFund = jest.fn();
    const onOpenSecureDetails = jest.fn();
    const onFreezeChange = jest.fn();
    const onControlChange = jest.fn();
    const onRequestWalletProvisioning = jest.fn();
    const onOpenActivity = jest.fn();

    render(
      <CardExperience
        state={issuedState}
        fundingEntry={({ disabled }) => <Button disabled={disabled} onClick={onFund}>Add funds</Button>}
        onOpenSecureDetails={onOpenSecureDetails}
        onFreezeChange={onFreezeChange}
        onControlChange={onControlChange}
        onRequestWalletProvisioning={onRequestWalletProvisioning}
        onOpenActivity={onOpenActivity}
      />,
    );

    expect(page().getByText("$420.75 is allocated from your Home balance—not counted twice.")).toBeTruthy();
    expect(page().getByText("Card numbers stay behind the secure details step.")).toBeTruthy();
    expect(page().getByText("Declined · Not charged · Today, 8:02 AM")).toBeTruthy();
    expect(page().getByText("Refunded · Returned to available funds · Sep 17")).toBeTruthy();

    fireEvent.click(page().getByRole("button", { name: "Add funds" }));
    fireEvent.click(page().getByRole("button", { name: "View details" }));
    fireEvent.click(page().getByRole("button", { name: "Freeze" }));
    fireEvent.click(page().getByRole("switch", { name: "Online purchases" }));
    fireEvent.click(page().getByRole("button", { name: "Check setup" }));
    fireEvent.click(page().getByRole("button", { name: /Harbor Grocer/ }));

    expect(onFund).toHaveBeenCalledTimes(1);
    expect(onOpenSecureDetails).toHaveBeenCalledTimes(1);
    expect(onFreezeChange).toHaveBeenCalledWith(true);
    expect(onControlChange).toHaveBeenCalledWith("online", false);
    expect(onRequestWalletProvisioning).toHaveBeenCalledTimes(1);
    expect(onOpenActivity).toHaveBeenCalledWith("decline-1");
  });

  test("keeps observed data visible and pauses card changes during an outage", () => {
    const onFreezeChange = jest.fn();
    const onControlChange = jest.fn();
    const onContactSupport = jest.fn();
    render(
      <CardExperience
        state={{ ...issuedState, serviceStatus: "outage", updatedAt: "Sep 18, 4:10 PM" }}
        fundingEntry={({ disabled }) => <Button disabled={disabled}>Add funds</Button>}
        onFreezeChange={onFreezeChange}
        onControlChange={onControlChange}
        onContactSupport={onContactSupport}
      />,
    );

    expect(page().getByRole("alert").textContent).toContain("temporarily unavailable");
    expect(page().getByText("Updated Sep 18, 4:10 PM")).toBeTruthy();
    expect((page().getByRole("button", { name: "Add funds" }) as HTMLButtonElement).disabled).toBe(true);
    expect((page().getByRole("button", { name: "Freeze" }) as HTMLButtonElement).disabled).toBe(true);
    const control = page().getByRole("switch", { name: "Online purchases" });
    expect(
      control.getAttribute("aria-disabled") === "true" ||
      control.hasAttribute("data-disabled") ||
      control.hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.click(page().getByRole("button", { name: "Support" }));
    expect(onContactSupport).toHaveBeenCalledTimes(1);
    expect(onFreezeChange).not.toHaveBeenCalled();
    expect(onControlChange).not.toHaveBeenCalled();
  });
});
