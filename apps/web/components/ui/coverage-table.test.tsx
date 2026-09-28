import "@/client/account/dom-test-harness";

import type { CoverageTableRow } from "./coverage-table";

import { afterEach, describe, expect, test } from "bun:test";

const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { CoverageTable } = await import("./coverage-table");

const identifiedRow: CoverageTableRow = {
  countryCode: "US",
  countryName: "United States",
  flag: "🇺🇸",
  currencies: "USD",
  asset: "USDC",
  issuerName: "Circle",
  stablecoin: { candidate: { symbol: "USDC", issuer: "Circle", verification: "Verification pending" } },
  portfolio: { status: "not-scoped", workstreams: [] },
  issuer: { status: "not-researched", rail: "Not researched", audience: "Not researched", evidence: null },
  home: { status: "sandbox", provider: "coinbase", asset: "base:usdc", paymentMethods: ["apple-pay"], evidence: null },
  quote: null,
  registryCheckedAt: "2026-09-15",
};

afterEach(cleanup);

describe("CoverageTable", () => {
  test("renders the Stablecoin, 1:1 onramp, Portfolio, and Integrated signal columns with icon-only triggers", () => {
    const view = render(<CoverageTable rows={[identifiedRow]} />);

    expect(view.getByRole("columnheader", { name: "Stablecoin" })).toBeTruthy();
    expect(view.getByRole("columnheader", { name: "1:1 onramp" })).toBeTruthy();
    expect(view.getByRole("columnheader", { name: "Portfolio" })).toBeTruthy();
    expect(view.getByRole("columnheader", { name: "Integrated" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Yellow — Stablecoin candidate identified" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Yellow — Not researched 1:1 onramp" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Yellow — Not scoped portfolio" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Yellow — Sandbox integration" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Yellow — Stablecoin candidate identified" }).textContent).toBe("");
  });

  test("details a multi-route priority with issue links and stages", async () => {
    const priorityRow: CoverageTableRow = {
      ...identifiedRow,
      countryCode: "MX",
      countryName: "Mexico",
      portfolio: {
        status: "priority",
        workstreams: [
          { currencyCode: "MXN", assetSymbol: "MXNB", provider: "Juno / Bitso", issueNumber: 552, issueUrl: "https://github.com/jessepollak/home/issues/552", stage: "planned", note: "API proof pending." },
          { currencyCode: "MXN", assetSymbol: "wMXN", provider: "Ripio", issueNumber: 512, issueUrl: "https://github.com/jessepollak/home/issues/512", stage: "blocked", note: "Audience proof pending." },
        ],
      },
    };
    const view = render(<CoverageTable rows={[priorityRow]} />);

    fireEvent.click(view.getByRole("button", { name: "Yellow — Priority portfolio" }));
    const popup = await view.findByRole("dialog");
    expect(popup.textContent).toContain("MXN → MXNB via Juno / Bitso — Planned");
    expect(popup.textContent).toContain("MXN → wMXN via Ripio — Blocked");
    expect(view.getByRole("link", { name: /MXNB/ }).getAttribute("href")).toBe("https://github.com/jessepollak/home/issues/552");
  });

  test("details an identified stablecoin candidate without claiming availability", async () => {
    const view = render(<CoverageTable rows={[identifiedRow]} />);

    fireEvent.click(view.getByRole("button", { name: "Yellow — Stablecoin candidate identified" }));
    const popup = await view.findByRole("dialog");

    expect(popup.textContent).toContain("StatusIdentified");
    expect(popup.textContent).toContain("Candidate assetUSDC");
    expect(popup.textContent).toContain("IssuerCircle");
    expect(popup.textContent).toContain("VerificationVerification pending");
    expect(popup.textContent).toContain("FundingDisabled");
  });

  test("marks missing candidates red as not identified", async () => {
    const view = render(<CoverageTable rows={[{ ...identifiedRow, countryCode: "CN", countryName: "China", stablecoin: { candidate: null } }]} />);

    const trigger = view.getByRole("button", { name: "Red — No stablecoin candidate identified" });
    expect(trigger.getAttribute("data-tone")).toBe("red");

    fireEvent.click(trigger);
    const popup = await view.findByRole("dialog");
    expect(popup.textContent).toContain("StatusNot identified");
    expect(popup.textContent).toContain("Candidate assetNot identified");
  });

  test("marks the containing row expanded only while one of its status popovers is open", async () => {
    const view = render(<CoverageTable rows={[identifiedRow]} />);
    const trigger = view.getByRole("button", { name: "Yellow — Stablecoin candidate identified" });
    const row = trigger.closest("tr");
    expect(row?.getAttribute("data-state")).toBeNull();

    fireEvent.click(trigger);
    await view.findByRole("dialog");
    expect(row?.getAttribute("data-state")).toBe("expanded");

    fireEvent.click(trigger);
    await waitFor(() => expect(row?.getAttribute("data-state")).toBeNull());
  });

  test("marks each row from its own open status popover", async () => {
    const view = render(<CoverageTable rows={[identifiedRow, { ...identifiedRow, countryCode: "CA", countryName: "Canada" }]} />);
    const triggers = view.getAllByRole("button", { name: "Yellow — Stablecoin candidate identified" });
    const canada = triggers[1]?.closest("tr");

    fireEvent.click(triggers[1]!);
    await waitFor(() => expect(canada?.getAttribute("data-state")).toBe("expanded"));

    fireEvent.click(triggers[1]!);
    await waitFor(() => expect(canada?.getAttribute("data-state")).toBeNull());
  });

  test("keeps the expanded mark on its own row when the table reorders", async () => {
    const canada = { ...identifiedRow, countryCode: "CA", countryName: "Canada" };
    const view = render(<CoverageTable rows={[identifiedRow, canada]} />);
    const canadaTrigger = view.getAllByRole("button", { name: "Yellow — Stablecoin candidate identified" })[1]!;

    fireEvent.click(canadaTrigger);
    await waitFor(() => expect(canadaTrigger.closest("tr")?.getAttribute("data-state")).toBe("expanded"));

    view.rerender(<CoverageTable rows={[canada, identifiedRow]} />);

    await waitFor(() => {
      const rows = [...view.container.querySelectorAll("tbody tr")];
      expect(rows[0]?.textContent).toContain("Canada");
      expect(rows[0]?.getAttribute("data-state")).toBe("expanded");
      expect(rows[1]?.getAttribute("data-state")).toBeNull();
    });
  });

  test("clears the expanded mark when an open preview's row leaves and returns", async () => {
    const canada = { ...identifiedRow, countryCode: "CA", countryName: "Canada" };
    const view = render(<CoverageTable rows={[identifiedRow, canada]} />);
    const canadaTrigger = view.getAllByRole("button", { name: "Yellow — Stablecoin candidate identified" })[1]!;

    fireEvent.click(canadaTrigger);
    await waitFor(() => expect(canadaTrigger.closest("tr")?.getAttribute("data-state")).toBe("expanded"));

    view.rerender(<CoverageTable rows={[identifiedRow]} />);
    await waitFor(() => expect([...view.container.querySelectorAll("tbody tr")].every((row) => row.getAttribute("data-state") === null)).toBe(true));

    view.rerender(<CoverageTable rows={[identifiedRow, canada]} />);
    await waitFor(() => expect([...view.container.querySelectorAll("tbody tr")].every((row) => row.getAttribute("data-state") === null)).toBe(true));
  });
});
