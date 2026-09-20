import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CoverageTable, type CoverageTableRow } from "./coverage-table";

const rows: CoverageTableRow[] = [
  {
    countryCode: "US",
    countryName: "United States",
    flag: "🇺🇸",
    currencies: "USD",
    asset: "USDC",
    issuerName: "Circle",
    stablecoin: { candidate: { symbol: "USDC", issuer: "Circle", verification: "Verified" } },
    portfolio: {
      status: "priority",
      workstreams: [
        {
          currencyCode: "USD",
          assetSymbol: "USDC",
          provider: "Coinbase",
          issueNumber: 42,
          issueUrl: "https://github.com/jessepollak/home/issues/42",
          stage: "in-build",
          note: "Gate: funding route evidence",
        },
      ],
    },
    issuer: {
      status: "documented",
      rail: "ACH",
      audience: "US persons",
      evidence: { url: "https://example.com/issuer-evidence", checkedAt: "2026-09-10" },
    },
    home: {
      status: "live",
      provider: "Coinbase",
      asset: "USDC",
      paymentMethods: ["ACH"],
      evidence: { proofRef: "hosted-production-2026-09-10", checkedAt: "2026-09-10" },
    },
    quote: {
      quotedAt: "2026-09-10T12:00:00.000Z",
      spreadBps: 10,
      feeSummary: "No Home fee recorded",
      sourceUrl: "https://example.com/quote-observation",
    },
    registryCheckedAt: "2026-09-10",
  },
  {
    countryCode: "BR",
    countryName: "Brazil",
    flag: "🇧🇷",
    currencies: "BRL",
    asset: "Not configured",
    issuerName: "Not configured",
    stablecoin: { candidate: null },
    portfolio: { status: "deferred", workstreams: [] },
    issuer: { status: "not-researched", rail: "Not recorded", audience: "Not researched", evidence: null },
    home: { status: "none", provider: null, asset: null, paymentMethods: [], evidence: null },
    quote: null,
    registryCheckedAt: "2026-09-10",
  },
];

const meta = {
  id: "ui-coverage-table",
  title: "UI/Coverage Table",
  component: CoverageTable,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof CoverageTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { rows } };
