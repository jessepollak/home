import type { ReactNode } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Act, type ActFeature } from "./act";

export const metadata = { title: "Home · Option C", robots: { index: false } };

const repo = "https://github.com/jessepollak/home";
const talkToUs = "https://x.com/jessepollak";
const deployGuide = `${repo}/blob/main/docs/vercel-deploy.md`;
const licence = `${repo}/blob/main/LICENSE`;

function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
      {children}
    </a>
  );
}

const customerFeatures: ActFeature[] = [
  { id: "add-money", title: "Add money", body: "With Apple Pay through Coinbase Onramp in the US, or by receiving USDC at their own address." },
  { id: "send", title: "Send", body: "To any Base address, with a review of amount, recipient and network fee." },
  { id: "save", title: "Save", body: "Earn a variable rate on USDC through Morpho vaults." },
  { id: "cash-out", title: "Cash out", body: "Through Peer to apps such as Cash App, Zelle, Revolut or Monzo, in the countries you enable." },
  { id: "activity", title: "Activity", body: "Transfers, funding orders and cash-outs in one place, with pending and confirmed kept distinct." },
  { id: "referrals", title: "Referrals", body: "Each customer gets a personal invite link in Account to copy or share. A new customer who signs up through it is attributed to that invite, and the count shows in Growth." },
];

const teamFeatures: ActFeature[] = [
  { id: "brand", title: "Your brand", body: "Set the name, description and colours in the admin console, and serve the app on your own domain." },
  { id: "management", title: "Management", body: "The admin console has a support inbox, where you answer customers yourself or let an assistant answer first and hand off when a person is needed. It also tracks fee revenue from swaps and walks you through setup. Customer search and the audit log aren't built yet." },
  { id: "growth", title: "Growth", body: "Growth counts the invite links your customers have made and the sign-ups that came through them. That is all it tracks today; there is no reward program yet." },
];

const hero = (
  <div className="pt-14 pb-6 md:flex md:min-h-[calc(100dvh-4rem)] md:flex-col md:justify-center md:py-16">
    <h1 className="text-4xl leading-tight font-semibold tracking-tight text-balance md:text-5xl">Run your own neobank on Base. Open source.</h1>
    <p className="mt-5 max-w-xl text-lg text-pretty text-foreground/70">
      Home is the software for a branded money app. You bring the customers, the brand and the regional know-how. Home supplies the customer app, the provider integrations and the admin console.
    </p>
    <div className="mt-8 flex flex-wrap gap-3">
      <a href={talkToUs} className={buttonVariants({ size: "touch", className: "px-4" })}>Talk to us</a>
      <a href={repo} className={buttonVariants({ variant: "outline", size: "touch", className: "px-4" })}>Read the code</a>
    </div>
  </div>
);

export default function Page() {
  return (
    <>
      <header className="border-b bg-background">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
          <Link href="/" className="flex items-center gap-3 rounded-sm text-base font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span aria-hidden="true" className="size-6 rounded-sm bg-primary" />
            Home
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-1">
            <a href={repo} className={buttonVariants({ variant: "ghost", size: "lg" })}>GitHub</a>
            <a href={talkToUs} className={buttonVariants({ variant: "outline", size: "lg" })}>Talk to us</a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5">
        <Act id="customers" frame="phone" title="For your customers" features={customerFeatures} intro={hero} />
        <Act id="team" frame="admin" title="For your team" features={teamFeatures} />

        <section aria-labelledby="talk" className="py-10 md:py-14">
          <Card className="gap-0 p-6 md:p-10">
            <h2 id="talk" className="text-2xl font-semibold tracking-tight">Talk to us</h2>
            <p className="mt-3 max-w-xl text-base text-pretty text-muted-foreground">
              We are looking for the first team to run Home for its own customers. No licence fee. The first operator works directly with Jesse.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
              <a href={talkToUs} className={buttonVariants({ size: "touch", className: "px-4" })}>Message @jessepollak on X</a>
              <TextLink href={repo}>GitHub</TextLink>
              <TextLink href={deployGuide}>Deploy guide</TextLink>
            </div>
            <p className="mt-8 border-t pt-4 text-sm text-pretty text-muted-foreground">
              Web only, English only, no card yet. Onramp and cash-out are still being proven with real money, and Home is not yet production-authorized.
            </p>
          </Card>
        </section>
      </main>

      <footer className="mx-auto max-w-6xl px-5 pb-10 text-xs text-foreground/70">
        Home&apos;s original code is open source under the <a href={licence} className="rounded-sm underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">MIT licence</a>. Marks and fonts keep their own terms.
      </footer>
    </>
  );
}
