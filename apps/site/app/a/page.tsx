import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowDown } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AddMoneyDemo, BrandDemo, SaveDemo, SendDemo } from "../features/demos";
import { GrowthDemo, ReferralDemo } from "../features/operator-demos";
import { ChapterProgress } from "./chapter-progress";
import { StoryActivityDemo, StoryCashOutDemo, StoryManagementDemo } from "./story-demos";

export const metadata = { title: "Home · Option A", robots: { index: false } };

const repo = "https://github.com/jessepollak/home";
const talkToUs = "https://x.com/jessepollak";
const deployGuide = `${repo}/blob/main/docs/vercel-deploy.md`;
const licence = `${repo}/blob/main/LICENSE`;

const chapters = [
  { id: "add-money", label: "Add money", part: 1 },
  { id: "save", label: "Save", part: 1 },
  { id: "send", label: "Send", part: 1 },
  { id: "cash-out", label: "Cash out", part: 1 },
  { id: "activity", label: "Activity", part: 1 },
  { id: "brand", label: "Your brand", part: 2 },
  { id: "management", label: "Management", part: 2 },
  { id: "referrals", label: "Referrals", part: 2 },
  { id: "growth", label: "Growth", part: 2 },
] as const;

function Chapter({ id, beat, children, demo }: { id: (typeof chapters)[number]["id"]; beat: string; children: ReactNode; demo: ReactNode }) {
  const index = chapters.findIndex((chapter) => chapter.id === id);
  const chapter = chapters[index];
  return (
    <section id={id} aria-labelledby={`${id}-beat`} className="grid scroll-mt-28 items-start gap-8 border-t py-12 md:grid-cols-2 md:gap-16 md:py-20">
      <div className="max-w-md md:sticky md:top-40">
        <p className="flex items-baseline gap-3 text-sm">
          <span className="text-muted-foreground tabular-nums">{String(index + 1).padStart(2, "0")}</span>
          <span className="font-medium">{chapter?.label}</span>
        </p>
        <h2 id={`${id}-beat`} className="mt-3 text-3xl leading-tight font-semibold tracking-tight text-balance">{beat}</h2>
        <p className="mt-4 text-base text-pretty text-foreground/70">{children}</p>
      </div>
      {demo}
    </section>
  );
}

function Part({ id, number, title, children }: { id: string; number: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-t py-14 md:py-24">
      <p className="text-sm text-muted-foreground">{number}</p>
      <h2 id={id} className="mt-3 max-w-2xl text-4xl leading-tight font-semibold tracking-tight text-balance md:text-5xl">{title}</h2>
      <p className="mt-5 max-w-xl text-lg text-pretty text-foreground/70">{children}</p>
    </section>
  );
}

function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
      {children}
    </a>
  );
}

export default function Page() {
  return (
    <>
      <header className="sticky top-0 z-10 border-b bg-background">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-5">
          <Link href="/" className="flex items-center gap-3 rounded-sm text-base font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span aria-hidden="true" className="size-6 rounded-sm bg-primary" />
            Home
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-1">
            <a href={repo} className={buttonVariants({ variant: "ghost", size: "lg" })}>GitHub</a>
            <a href={talkToUs} className={buttonVariants({ variant: "outline", size: "lg" })}>Talk to us</a>
          </nav>
        </div>
        <ChapterProgress chapters={chapters} />
      </header>

      <main className="mx-auto max-w-5xl px-5">
        <div className="max-w-2xl pt-14 pb-14 md:pt-24 md:pb-24">
          <h1 className="text-4xl leading-tight font-semibold tracking-tight text-balance md:text-5xl">Run your own neobank on Base. Open source.</h1>
          <p className="mt-5 max-w-xl text-lg text-pretty text-foreground/70">
            Home is the software for a branded money app. You bring the customers, the brand and the regional know-how. Home supplies the customer app, the provider integrations and the admin console.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={talkToUs} className={buttonVariants({ size: "touch", className: "px-4" })}>Talk to us</a>
            <a href={repo} className={buttonVariants({ variant: "outline", size: "touch", className: "px-4" })}>Read the code</a>
          </div>
          <a href="#maya" className="group mt-10 inline-flex min-h-11 items-center gap-2 rounded-sm text-base font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Follow Maya, a sample customer
            <ArrowDown aria-hidden="true" className="size-4 text-muted-foreground transition-transform duration-base ease-standard group-hover:translate-y-0.5 motion-reduce:transition-none" />
          </a>
        </div>

        <div id="maya" className="scroll-mt-28">
          <Part id="part-maya" number="Part one" title="Maya's money">
            Maya is a sample customer of an app built on Home. In one morning she adds money, saves some, pays a friend back and cashes out.
          </Part>
        </div>

        <Chapter id="add-money" beat="Maya adds $200." demo={<AddMoneyDemo />}>
          With Apple Pay through Coinbase Onramp in the US, or by receiving USDC at their own address.
        </Chapter>
        <Chapter id="save" beat="She puts $100 aside." demo={<SaveDemo />}>
          Earn a variable rate on USDC through Morpho vaults.
        </Chapter>
        <Chapter id="send" beat="She pays a friend back $25." demo={<SendDemo />}>
          To any Base address, with a review of amount, recipient and network fee.
        </Chapter>
        <Chapter id="cash-out" beat="She cashes out $50 to Cash App." demo={<StoryCashOutDemo />}>
          Through Peer to apps such as Cash App, Zelle, Revolut or Monzo, in the countries you enable.
        </Chapter>
        <Chapter id="activity" beat="Her whole morning, in one list." demo={<StoryActivityDemo />}>
          Transfers, funding orders and cash-outs in one place, with pending and confirmed kept distinct.
        </Chapter>

        <Part id="part-operator" number="Part two" title="The team that runs her app">
          Maya&apos;s app belongs to an operator: the team that sets its brand, answers her questions and grows it from Home&apos;s admin console.
        </Part>

        <Chapter id="brand" beat="Her app wears its operator's brand." demo={<BrandDemo />}>
          Set the name, description and colours in the admin console, and serve the app on your own domain.
        </Chapter>
        <Chapter id="management" beat="When Maya asks for help, someone answers." demo={<StoryManagementDemo />}>
          The admin console has a support inbox, where you answer customers yourself or let an assistant answer first and hand off when a person is needed. It also tracks fee revenue from swaps and walks you through setup. Customer search and the audit log aren&apos;t built yet.
        </Chapter>
        <Chapter id="referrals" beat="Maya invites a friend." demo={<ReferralDemo />}>
          Each customer gets a personal invite link in Account to copy or share. A new customer who signs up through it is attributed to that invite, and the count shows in Growth.
        </Chapter>
        <Chapter id="growth" beat="Her invite shows up in Growth." demo={<GrowthDemo />}>
          Growth counts the invite links your customers have made and the sign-ups that came through them. That is all it tracks today; there is no reward program yet.
        </Chapter>

        <section aria-labelledby="talk" className="border-t py-12 md:py-20">
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

      <footer className="mx-auto max-w-5xl px-5 pb-10 text-xs text-foreground/70">
        Home&apos;s original code is open source under the <a href={licence} className="rounded-sm underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">MIT licence</a>. Marks and fonts keep their own terms.
      </footer>
    </>
  );
}
