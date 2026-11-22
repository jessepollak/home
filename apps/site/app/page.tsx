import Image from "next/image";
import type { ReactNode } from "react";

const repo = "https://github.com/jessepollak/home";
const docs = `${repo}/blob/main/docs`;
const talkToUs = "https://x.com/jessepollak";

type Fact = { term: string; detail: ReactNode };

const customerFacts: Fact[] = [
  { term: "Add money", detail: "With Apple Pay through Coinbase Onramp in the US, or by receiving USDC at their own address." },
  { term: "Hold", detail: "USDC and local stablecoins in one balance." },
  { term: "Save", detail: "Earn a variable rate on cash through Morpho vaults." },
  { term: "Trade", detail: "Buy and sell tokens on Base." },
  { term: "Borrow", detail: "Borrow against cbBTC and cbETH." },
  { term: "Send", detail: "To any Base address, with a review of amount, recipient and network fee." },
  { term: "Cash out", detail: "Through Peer to apps such as Cash App, Zelle, Revolut or Monzo, in the countries you enable." },
  { term: "Activity", detail: "Transfers, funding orders and cash-outs in one place, with pending and confirmed kept distinct." },
];

const operatorFacts: Fact[] = [
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

const requirementFacts: Fact[] = [
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

const status = [
  "Web only. There is no native app yet.",
  "English only.",
  "No card yet.",
  "Onramp and cash-out are still being proven with real money.",
  "Home is not yet production-authorized.",
  "Some admin views, such as customer search, are not built yet.",
];

function Facts({ facts }: { facts: Fact[] }) {
  return (
    <dl className="facts">
      {facts.map((fact) => (
        <div key={fact.term}>
          <dt>{fact.term}</dt>
          <dd>{fact.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <div>{children}</div>
    </section>
  );
}

const captures = [
  { src: "/captures/home.png", alt: "Home dashboard with total balance, Add money and Send, and recent Activity" },
  { src: "/captures/cash.png", alt: "Cash with a US dollar stablecoin balance and savings" },
  { src: "/captures/activity.png", alt: "Activity with a pending cash-out, an Add money order, and sent and received transfers" },
];

export default function Page() {
  return (
    <div className="page">
      <header className="masthead">
        <span className="wordmark">Home</span>
        <nav aria-label="Primary">
          <a href={repo}>GitHub</a>
          <a href={talkToUs}>Talk to us</a>
        </nav>
      </header>

      <main>
        <div className="intro">
          <h1>Run your own neobank on Base. Open source.</h1>
          <p className="lede">
            Home is the software for a branded money app. You bring the customers, the brand and the regional know-how. Home supplies the customer app, the provider integrations and the admin console.
          </p>
          <div className="intro-links">
            <a href={talkToUs}>Talk to us on X</a>
            <a href={repo}>Read the code on GitHub</a>
          </div>
        </div>

        <figure className="captures">
          <div className="captures-row">
            {captures.map((capture) => (
              <Image key={capture.src} src={capture.src} alt={capture.alt} width={780} height={1688} loading="eager" />
            ))}
          </div>
          <figcaption>The current app, rendered with sample data.</figcaption>
        </figure>

        <Section id="customers" title="What your customers get">
          <Facts facts={customerFacts} />
        </Section>

        <Section id="operators" title="What you get">
          <Facts facts={operatorFacts} />
        </Section>

        <Section id="requirements" title="What it takes to run">
          <p>
            Each operator runs their own instance on their own accounts. Start with the <a href={`${docs}/vercel-deploy.md`}>deploy guide</a> and the{" "}
            <a href={`${docs}/operator-checklist.md`}>operator checklist</a>.
          </p>
          <Facts facts={requirementFacts} />
        </Section>

        <Section id="status" title="Where it stands today">
          <ul className="status">
            {status.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Section>

        <Section id="talk" title="Talk to us">
          <p>
            We are looking for the first team to run Home for its own customers. That team works directly with Jesse. <a href={talkToUs}>Message @jessepollak on X</a>, or open an issue on{" "}
            <a href={repo}>GitHub</a>.
          </p>
        </Section>
      </main>

      <footer className="footer">
        <p>
          Home's original code is open source under the <a href={`${repo}/blob/main/LICENSE`}>MIT licence</a>. Marks and fonts keep their own terms.
        </p>
      </footer>
    </div>
  );
}
