import type { ReactNode } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ActivityDemo, AddMoneyDemo, BrandDemo, CashOutDemo, SaveDemo, SendDemo } from "../features/demos";
import { GrowthDemo, ManagementDemo, ReferralDemo } from "../features/operator-demos";
import { AudienceSwitch } from "./audience-switch";
import { ConsoleRail } from "./console-rail";
import { Backdrop, type BackdropVariant } from "../backdrop/backdrop";

const repo = "https://github.com/jessepollak/home";
const talkToUs = "https://x.com/jessepollak";
const deployGuide = `${repo}/blob/main/docs/vercel-deploy.md`;
const licence = `${repo}/blob/main/LICENSE`;

function Feature({ id, title, children, demo, backdrop }: { id: string; title: string; children: ReactNode; demo: ReactNode; backdrop: BackdropVariant }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="grid scroll-mt-20 items-center gap-8 py-10 md:grid-cols-2 md:gap-16 md:py-14">
      <div className="max-w-md">
        <h3 id={`${id}-title`} className="text-2xl font-semibold tracking-tight text-balance">{title}</h3>
        <p className="mt-3 text-base text-pretty text-foreground/70">{children}</p>
      </div>
      <Backdrop variant={backdrop} region="demo">{demo}</Backdrop>
    </section>
  );
}

function HalfHeader({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div className="max-w-2xl pt-24 pb-4 md:pt-28 md:pb-8">
      <h2 id={id} className="text-3xl leading-tight font-semibold tracking-tight text-balance md:text-4xl">{title}</h2>
      <p className="mt-4 max-w-xl text-lg text-pretty text-foreground/70">{children}</p>
    </div>
  );
}

function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
      {children}
    </a>
  );
}

export function OptionB({ backdrop = "none" }: { backdrop?: BackdropVariant }) {
  return (
    <>
      <header className="border-b bg-background">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between gap-4 px-5">
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

      <main>
        <Backdrop variant={backdrop} region="hero">
        <div className="mx-auto max-w-4xl px-5">
          <div className="max-w-2xl pt-14 pb-10 md:pt-20 md:pb-14">
            <h1 className="text-4xl leading-tight font-semibold tracking-tight text-balance md:text-5xl">Run your own neobank on Base. Open source.</h1>
            <p className="mt-5 max-w-xl text-lg text-pretty text-foreground/70">
              Home is the software for a branded money app. You bring the customers, the brand and the regional know-how. Home supplies the customer app, the provider integrations and the admin console.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={talkToUs} className={buttonVariants({ size: "touch", className: "px-4" })}>Talk to us</a>
              <a href={repo} className={buttonVariants({ variant: "outline", size: "touch", className: "px-4" })}>Read the code</a>
            </div>
          </div>
        </div>
        </Backdrop>

        <div>
          <AudienceSwitch />

          <section id="customers" aria-labelledby="customers-title">
            <Backdrop variant={backdrop} region="customers">
            <div className="mx-auto max-w-4xl px-5">
              <HalfHeader id="customers-title" title="For your customers">
                Say Alice opens your app. She adds $200, sends $25 to a friend, puts $100 into savings and cashes out $50 to Cash App. Each step lands in her Activity.
              </HalfHeader>
              <Feature id="add-money" title="Add money" backdrop={backdrop} demo={<AddMoneyDemo />}>
                With Apple Pay through Coinbase Onramp in the US, or by receiving USDC at their own address.
              </Feature>
              <Feature id="send" title="Send" backdrop={backdrop} demo={<SendDemo />}>
                To any Base address, with a review of amount, recipient and network fee.
              </Feature>
              <Feature id="save" title="Save" backdrop={backdrop} demo={<SaveDemo />}>
                Earn a variable rate on USDC through Morpho vaults.
              </Feature>
              <Feature id="cash-out" title="Cash out" backdrop={backdrop} demo={<CashOutDemo />}>
                Through Peer to apps such as Cash App, Zelle, Revolut or Monzo, in the countries you enable.
              </Feature>
              <Feature id="activity" title="Activity" backdrop={backdrop} demo={<ActivityDemo />}>
                Transfers, funding orders and cash-outs in one place, with pending and confirmed kept distinct.
              </Feature>
            </div>
            </Backdrop>
          </section>

          <section id="team" aria-labelledby="team-title" className="mt-10 border-y bg-background pb-10 md:mt-14">
            <Backdrop variant={backdrop} region="team">
            <div className="mx-auto max-w-4xl px-5 lg:max-w-6xl">
              <div className="lg:ps-60">
                <HalfHeader id="team-title" title="For your team">
                  Behind the app Alice uses is your admin console. You put your name and colours on the app, answer a customer whose funding order needs help, and see an invite link turn into a sign-up.
                </HalfHeader>
              </div>
              <div className="lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-12">
                <ConsoleRail />
                <div>
                  <Feature id="brand" title="Your brand" backdrop={backdrop} demo={<BrandDemo />}>
                    Set the name, description and colours in the admin console, and serve the app on your own domain.
                  </Feature>
                  <Feature id="management" title="Management" backdrop={backdrop} demo={<ManagementDemo />}>
                    The admin console has a support inbox, where you answer customers yourself or let an assistant answer first and hand off when a person is needed. It also tracks fee revenue from swaps and walks you through setup. Customer search and the audit log aren&apos;t built yet.
                  </Feature>
                  <Feature id="referrals" title="Referrals" backdrop={backdrop} demo={<ReferralDemo />}>
                    Each customer gets a personal invite link in Account to copy or share. A new customer who signs up through it is attributed to that invite, and the count shows in Growth.
                  </Feature>
                  <Feature id="growth" title="Growth" backdrop={backdrop} demo={<GrowthDemo />}>
                    Growth counts the invite links your customers have made and the sign-ups that came through them. That is all it tracks today; there is no reward program yet.
                  </Feature>
                </div>
              </div>
            </div>
            </Backdrop>
          </section>
        </div>

        <div className="mx-auto max-w-4xl px-5">
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
        </div>
      </main>

      <footer className="mx-auto max-w-4xl px-5 pb-10 text-xs text-foreground/70">
        Home&apos;s original code is open source under the <a href={licence} className="rounded-sm underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">MIT licence</a>. Marks and fonts keep their own terms.
      </footer>
    </>
  );
}
