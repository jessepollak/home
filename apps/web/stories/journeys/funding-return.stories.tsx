import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { FundingExperienceForWallet } from "@/client/funding/funding-experience";
import { PresentationRegionProvider } from "@/client/invest/presentation-quote";
import { getHomeQueryClient } from "@/client/query/query-client";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { FUNDING_OPEN_ORDER_VERSION } from "@/shared/funding/contracts/open-order";
import { FUNDING_PROVIDER_CUSTOMERS_VERSION, type FundingProviderCustomerSummary } from "@/shared/funding/contracts/provider-customers";
import { FUNDING_PROVIDERS_VERSION, type FundingBinding } from "@/shared/funding/contracts/providers";

const SESSION: VerifiedAccountSession = {
  user: { subject: "funding-return-story" },
  smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 },
  accountProvider: "base-account",
};
const binding: FundingBinding = {
  direction: "onramp", providerId: "ripio", displayName: "Ripio", region: "AR",
  assetId: "base:wars", assetSymbol: "wARS", assetDecimals: 18, currency: "ARS",
  paymentMethods: [{ id: "bank_transfer", label: "Bank transfer" }], quotes: true, customerSetup: null,
};
const partialOrder = {
  id: "11111111-1111-4111-8111-111111111111", providerId: "ripio", state: "awaiting-payment", fiatAmount: "1000",
};
const customer: FundingProviderCustomerSummary = {
  providerId: "ripio", region: "AR", state: "pending",
  verificationStartedAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z",
};
const steps: string[] = [];
let customerReads = 0;
type Scenario = "partial-open-order" | "partial-customer" | "partial-customer-retry";

function Journey({ scenario }: { scenario: Scenario }) {
  const fetchAccountResource: AccountWalletClient["fetchAccountResource"] = async (path) => {
    if (path.startsWith("/api/funding/providers?")) return {
      version: FUNDING_PROVIDERS_VERSION, direction: "onramp",
      providers: [scenario === "partial-open-order" ? binding : { ...binding, customerSetup: { hosted: true } }],
    };
    if (path.startsWith("/api/funding/orders?")) return {
      version: FUNDING_OPEN_ORDER_VERSION, order: scenario === "partial-open-order" ? partialOrder : null,
    };
    if (path.startsWith("/api/funding/provider-customers?")) {
      customerReads += 1;
      return {
        version: FUNDING_PROVIDER_CUSTOMERS_VERSION,
        customers: scenario === "partial-customer-retry" && customerReads > 1 ? [customer] : [{ providerId: "ripio" }],
      };
    }
    throw new Error(`Unexpected funding return request: ${path}`);
  };
  return <PresentationRegionProvider regionId="AR">
    <main><h1 className="sr-only">Funding return</h1>
      <FundingExperienceForWallet
        wallet={{ ownerKey: "funding-return-story", status: "verified", verification: "server", session: SESSION, fetchAccountResource }}
        navigateToRedirect={() => {}}
        returnedFromProvider={scenario === "partial-open-order"}
        returnedFromVerification={scenario !== "partial-open-order"}
        regionId="AR" initialStep="method" onStepChange={(step) => steps.push(step)}
      />
    </main>
  </PresentationRegionProvider>;
}

const meta = {
  id: "journeys-funding-return", title: "Journeys/Funding return", component: Journey,
  parameters: { viewport: { defaultViewport: "mobile" }, a11y: { test: "error" } },
  beforeEach() {
    getHomeQueryClient().clear();
    steps.length = 0;
    customerReads = 0;
  },
} satisfies Meta<typeof Journey>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PartialOpenOrder: Story = {
  args: { scenario: "partial-open-order" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByRole("heading", { name: "Add money" })).toBeVisible();
    await expect(await screen.findByRole("alert")).toHaveTextContent("Home couldn't check for an open deposit. Retry.");
    await expect(screen.getByRole("button", { name: /Deposit ARS/ })).toBeVisible();
    await expect(screen.queryByText("Deposit pending")).not.toBeInTheDocument();
    await expect(steps).not.toContain("order");
  },
};

export const PartialCustomer: Story = {
  args: { scenario: "partial-customer" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByRole("heading", { name: "Add money" })).toBeVisible();
    await expect(await screen.findByRole("alert")).toHaveTextContent("Home couldn't check your provider setup. Retry.");
    await expect(screen.queryByRole("heading", { name: "Set up Ripio" })).not.toBeInTheDocument();
    await expect(steps).not.toContain("order");
  },
};

export const PartialCustomerRetry: Story = {
  args: { scenario: "partial-customer-retry" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByRole("heading", { name: "Add money" })).toBeVisible();
    await expect(await screen.findByRole("alert")).toHaveTextContent("Home couldn't check your provider setup. Retry.");
    await expect(screen.queryByRole("heading", { name: "Set up Ripio" })).not.toBeInTheDocument();
    await expect(steps).not.toContain("order");
    await expect(customerReads).toBe(1);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await expect(await screen.findByRole("heading", { name: "Set up Ripio" })).toBeVisible();
    await waitFor(() => expect(steps.filter((step) => step === "order")).toHaveLength(1));
    await expect(customerReads).toBe(2);
  },
};
