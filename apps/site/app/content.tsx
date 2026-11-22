import type { ReactNode } from "react";

export const repo = "https://github.com/jessepollak/home";
export const docs = `${repo}/blob/main/docs`;
export const talkToUs = "https://x.com/jessepollak";

export type Fact = { term: string; detail: ReactNode };

export const customerFacts: Fact[] = [
  { term: "Add money", detail: "With Apple Pay through Coinbase Onramp in the US, or by receiving USDC at their own address." },
  { term: "Hold", detail: "USDC and local stablecoins in one balance." },
  { term: "Save", detail: "Earn a variable rate on cash through Morpho vaults." },
  { term: "Trade", detail: "Buy and sell tokens on Base." },
  { term: "Borrow", detail: "Borrow against cbBTC and cbETH." },
  { term: "Send", detail: "To any Base address, with a review of amount, recipient and network fee." },
  { term: "Cash out", detail: "Through Peer to apps such as Cash App, Zelle, Revolut or Monzo, in the countries you enable." },
  { term: "Activity", detail: "Transfers, funding orders and cash-outs in one place, with pending and confirmed kept distinct." },
];

export const operatorFacts: Fact[] = [
  { term: "Your brand and domain", detail: "Set the name, description and colours in the admin console, and serve the app on your own domain." },
  { term: "Your database and customer data", detail: "Customer records live in your own Postgres. Upstream Home receives no telemetry." },
  { term: "An admin console", detail: "A setup checklist, product and market settings, a support inbox, estimated swap fees and customer invite attribution." },
  { term: "The swap fee, paid to your wallet", detail: "Set a fee on trades and choose the address it is paid to." },
  { term: "Free under the MIT licence", detail: (
      <>
        No licence fee. The original code is MIT. The Home mark, its fonts and Base marks keep their own terms, so replace the default branding with your own.{" "}
        <a href={`${repo}/blob/main/apps/web/public/home-mark/PROVENANCE.md`}>Mark and font terms</a>
      </>
    ), },
  { term: "Direct support for the first operator", detail: "The first team to run Home works directly with Jesse Pollak." },
  { term: "Upstream updates", detail: "Merge upstream to take new features and fixes. The deploy guide covers the backup check to run first." },
];

export const requirementFacts: Fact[] = [
  {
    term: "Vercel",
    detail: (
      <>
        A project with Fluid compute, Firewall rules and Skew Protection. <a href={`${docs}/vercel-deploy.md#launch`}>Deploy guide</a>
      </>
    ),
  },
  {
    term: "Postgres",
    detail: (
      <>
        Neon through the Vercel Marketplace, or your own server. <a href={`${docs}/vercel-deploy.md#environment`}>Database setup</a>
      </>
    ),
  },
  {
    term: "A CDP project",
    detail: (
      <>
        Coinbase Developer Platform keys for customer wallets and server APIs. Onramp is approved per project. <a href={`${docs}/cdp-setup.md`}>CDP setup</a>
      </>
    ),
  },
  {
    term: "A Base RPC endpoint",
    detail: (
      <>
        A dedicated endpoint for hosted use, set as <code>BASE_RPC_URL</code>. <a href={`${docs}/operator-checklist.md`}>Operator checklist</a>
      </>
    ),
  },
];

export const status = [
  "Web only. There is no native app yet.",
  "English only.",
  "No card yet.",
  "Onramp and cash-out are still being proven with real money.",
  "Home is not yet production-authorized.",
  "Some admin views, such as customer search, are not built yet.",
];

export const captures = [
  { src: "/captures/home.png", alt: "Home dashboard with total balance, Add money and Send, and recent Activity" },
  { src: "/captures/cash.png", alt: "Cash with a US dollar stablecoin balance and savings" },
  { src: "/captures/activity.png", alt: "Activity with a pending cash-out, an Add money order, and sent and received transfers" },
];

export const pitch = "Run your own neobank on Base. Open source.";

export const lede =
  "Home is the software for a branded money app. You bring the customers, the brand and the regional know-how. Home supplies the customer app, the provider integrations and the admin console.";

export const captureCaption = "The current app, rendered with sample data.";

export const talkLead = "We are looking for the first team to run Home for its own customers. No licence fee. The first operator works directly with Jesse.";

export const licence = `${repo}/blob/main/LICENSE`;
