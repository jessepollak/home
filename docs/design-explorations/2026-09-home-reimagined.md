# Home reimagined — design exploration (issue #662)

**Status: exploration — unapproved.** Nothing in this document is production direction, a component decision, or a rollout plan. Jesse selects one direction or a hybrid before #655 (production adoption) proceeds. No production route, component, token, data model, or money path was changed by this exploration.

- Issue: [#662](https://github.com/jessepollak/home/issues/662) (`design(explore): reimagine Home from first principles with reference-led directions`), parent [#207](https://github.com/jessepollak/home/issues/207).
- Sibling: [#654](https://github.com/jessepollak/home/issues/654) / [PR #661](https://github.com/jessepollak/home/pull/661) — the disciplined reference journey inside today's constraints. #661 tells us what a coherent version of the current language looks like; this exploration asks whether that language is the right one at all.
- Direction reset that produced this pass: Jesse, [PR #661 comment, 2026-09-20](https://github.com/jessepollak/home/pull/661#issuecomment-5747994084) — neither Option A nor Option B selected; preserve financial logic, fixtures, inventory, and money-sheet integration; produce genuinely different directions with identical facts; defer the connected journey and full state matrix until a direction is selected.
- Downstream: [#655](https://github.com/jessepollak/home/issues/655) (production adoption) stays blocked on Jesse's selection.
- Rendering lives under a separate Storybook group, `Explorations/Home reimagined/*`, in `apps/web/client/explorations/home-reimagined/`. Nothing there is imported by `HomeShell`, a route, or any production surface.

Constraints this exploration respects: the component-workshop rules in [`docs/design-system.md`](../design-system.md) (stories beside the surface under `apps/web/client/**`, real production components rather than styled copies, fixture-only data, explicit stable story `id`s, manager/canvas paths); the money semantics owned by [`docs/architecture.md`](../architecture.md) and [`docs/actions.md`](../actions.md), which this exploration reuses rather than modifies; and the rule that Storybook proves fixture-backed composition only, while Home-level behavior must be verified under [`docs/browser-validation.md`](../browser-validation.md) by the adoption issue.

The framing below was produced by a fresh Astra/high pass for the direction reset (model recorded in PR #661 as `cbhq-openai/gpt-6-astra`, thinking high). Its substance is reproduced here; the rest of the document is implementation evidence and recommendation.

## Active checkpoint — Astra, reference-led funded Home

This pass replaces the four-direction exercise **for current review only**; the material below remains an archived exploration, not an adoption recommendation. One funded composition, no new Save screens or state matrix. Production money modals and all shared wrappers/tokens are untouched.

- **Inspected:** actual Mercury, Cash App, and Wealthfront images supplied locally; current `client/home` production sources; #675 and #661 via `gh`, including #661’s actual 390×844 Overview screenshot. Mercury leads the unboxed balance, whitespace, typography and separators; Cash App informs balance confidence and usable actions, not branding/promotions; Wealthfront informs Save balance/rate before management. No chart or performance history is invented.
- **Three decisions:** (1) the unboxed $1,250 net position leads a single canvas, while $250 available cash is separately paired with Fund; (2) Save shows $1,000 and **combined 4.04% APY** before its management entry, followed by quieter Invest Buy/Sell and Borrow; (3) all three fixed transfers are readable on Home above integrated navigation, without relabeling the plain outgoing transfer as a savings deposit.
- **Implementation:** `reference-home.tsx`, local geometry CSS, stories, comparison and focused tests; existing `fixtures.ts` / `money-state.ts` presenters and Base UI Button/Drawer wrappers. Fund, Save, Buy, Sell, Borrow and Account open explicit fixture-only modal handoff notices; they do not mutate money or imply provider eligibility. Home/Activity navigation moves within this composition. This is not a connected journey.
- **Evidence stories:** stable prefix `explorations-home-reimagined-astra--`, with `funded-home` (canonical 390×844), `reference-comparison-board`, `narrow-320` (320×844), `large-amounts` (existing long/large fixture and honest unquoted-IDR note), and `desktop-fit` (1280×800; same constrained composition). Canvas URL: `/iframe.html?id=<story-id>&viewMode=story`; manager URL: `/?path=/story/<story-id>`.
- **Comparison provenance:** the Storybook board keeps unscaled 390×844 inner frames for pinned current-production **source inventory**, archived #675 Money Map using the shared funded fixture, new Astra, and the actual Mercury promotional image at 390px width. Final review media adds an actual 390×844 current-production capture from the unchanged Home route under isolated browser fixtures; its clearly labeled `$90.54` smoke data differs from the `$1,250.00` exploration fixture, so it proves composition rather than a same-data comparison. Mercury is clearly attributed, copied only to `.storybook/static/references/mercury-official-promotional.png`, and never imported into Home UI. Production source is pinned to `11c8ee815d9e71caed1016370a76430cd9bd21ae`; #661’s screenshot informed inspection, not the “previous proposal” column.
- **Checked evidence:** 56 exploration tests, focused and full lint, typecheck, Storybook build, and repository checks pass. Repository-pinned agent-browser inspected the actual 390×844, 320×844, large-amount, desktop and comparison stories; mobile has no page overflow and every Home control measures at least 44px. Mercury loads at 390px; all proposal frames have 390×844 interiors. Axe found zero violations on 390px, 320px and the Fund notice; focus trapping, Escape restoration and foreground contrast were manually checked. A fresh Fable/high rendered critique first rejected the composition because Save visually outranked available cash and only the chevrons—not their full rows—were controls. The repair made cash and Save 24px peers, expanded Save/Borrow to full-row controls, bounded Activity focus, and corrected the rows’ accessible names/semantics. Final Fable/high verification marked the composition ready for Jesse’s visual review.
- **Limits:** funded-only visual decision; larger amounts may increase vertical scroll. The desktop safety view needs normal vertical scroll at 800px height. The Home/Activity bottom navigation is compositional, not a production routing proposal. No production behavior, provider validation, yield guarantee, or adoption approval is claimed; #655 stays blocked on Jesse’s explicit selection.

## Archived product frame

Today Home supports funding, saving, investing, and borrowing, but asks customers to parse product compartments first. The gap is that financial correctness alone still leaves two things unclear: which money is net position versus usable now, and what actually happened to an action.

This slice compares four models with the same facts, the same movement, and the same recovery path, on mobile and desktop, across languages and currencies. Not in this slice: production rollout, new capabilities, cards, invented history, or new dependencies. The decision this document supports: Jesse selects a direction or a hybrid before #655.

### Customer job

Understand where the money stands. Use the right portion confidently. Know what happened afterward.

### The three moments that matter

1. **Orient.** Net position versus available to use, and any uncertainty about either.
2. **Decide and act.** A deliberate destination and an exact review before anything moves.
3. **Return and recover.** A truthful status, a receipt that matches the balances, and one safe next step.

### Obvious versus quiet

- **Obvious on every direction:** net versus available, the next action, uncertainty, and pending/failed movement.
- **Quiet but findable:** reconciliation arithmetic, vault-level inventory, provenance of rates, older Activity, unused products, and legal disclosures.

### Emotions

- **Wanted:** oriented, capable, unhurried, in control.
- **Avoided:** impressed but confused, pushed toward yield or borrowing, falsely reassured, anxious about missing money.

### Time tests

- **5 seconds:** see net position versus available to use, and see whether anything is uncertain.
- **30 seconds:** locate Save and Activity, understand the combined rate, and start an action.
- **5 minutes:** complete a simulated save, inspect the receipt, and recover from a failure without guessing or duplicating a dispatch.

### Outcomes

Understand. Navigate. Act. Recover and return. The current slice is the isolated, comparable Storybook package; production adoption is a later, separately authorized slice.

### Design principles derived from the frame

1. **Two numbers before ten.** Net position and available to use lead; everything else is detail.
2. **One primary action per moment.** No screen asks a person to choose between four equal calls to action.
3. **Truthful state beats reassurance.** Loading, partial, pending, failed, and unknown each read as themselves.
4. **Detail on demand.** Totals do not repeat on every surface, and vault inventory is detail behind Saved.
5. **Recovery is a first-class surface.** A failed or unknown movement has an exact, safe next step.
6. **Motion explains change, never decorates money.** Frequently read financial values stay still.

## Shared synthetic facts and semantics

Every direction and every story renders the same fixture state. Nothing here reaches a provider, database, wallet, or live service.

| Fact | Value |
| --- | --- |
| Clock | `2026-09-19T12:04:00.000Z` (Sep 19, 2026 12:04 UTC) |
| Cash (available to use) | $250.00 |
| Gauntlet USDC Core vault | $750.00 at 4.10% APY |
| Steakhouse USDC vault | $250.00 at 3.85% APY |
| Re7 USDC vault | $0.00 (unfunded, still listed as a fact) |
| Saved | $1,000.00 |
| Weighted rate | 4.04% APY |
| Net position / assets | $1,250.00 |
| Debt | $0.00, verified (so the net position is stated without drilling into debt) |
| Action under test | save $100.00 into Gauntlet |
| After a **confirmed** action | cash $150.00, Gauntlet $850.00, saved $1,100.00, net position unchanged at $1,250.00 |
| Fixed history | received $250.00 (Sep 19 11:40Z), received $1,000.00 (Sep 18 15:12Z), deposited $1,000.00 (Sep 18 15:20Z) |

Semantics every direction must preserve:

- **Loading is not zero.** A loading slice renders a skeleton or "Incomplete"; it never renders `$0.00`.
- **Partial never claims a complete total.** If cash, saved, or debt is unavailable, the net position reads "Incomplete", the missing slice is named, and the reconciliation line is withheld rather than computed from what happened to be readable.
- **Pending and unknown never confirm, and never auto-retry.** Only a `confirmed` outcome changes balances. A `pending` movement is recorded with balances unchanged. A `failed` deposit can be deliberately retried with the same vault and amount. An `unknown` outcome refuses retry and routes to Activity, because sending again could move money twice. The same movement cannot be settled twice.
- **Long and localized content stays exact.** A long-IDR state (`reimaginedLongLocalizedState`) carries large balances, long vault names ("Gauntlet Diversified Onchain Treasury Savings Strategy Core"), and an Indonesian rupiah holding with no configured display quote. The IDR balance is excluded from the total and named by currency in a note; nothing is rounded, and names/amounts wrap instead of clipping.
- **Verified zero is a fact, not an absence.** A genuinely empty read (every slice answered, all zeros) is different from a loading or unavailable read.

Fixtures and the state model: `apps/web/client/explorations/home-reimagined/fixtures.ts`, `money-state.ts`.

## Reference research ledger

**Honesty note, read first.** The public Mobbin catalog at `https://mobbin.com/explore/mobile` was consulted without authentication. It exposed a limited trending feed (including Wise branding), but app search and continued browsing were gated behind “Log in or join for free”; no requested app screen or flow could be verified publicly. Direct profile guesses for the ten apps below (`https://www.mobbin.com/apps/<app>`) also returned **HTTP 404** on 2026-09-20. The issue's fallback rule was therefore applied: each app's official public page was consulted instead and returned HTTP 200. Those official pages are marketing surfaces. They establish capability framing and positioning, and in two cases a public calculator or explicit product-description copy; they do **not** verify in-app navigation, home hierarchy, balance-change presentation, activity/pending behavior, or motion. Where a dimension is not shown by the consulted source, it is recorded as **not established** — meaning the source does not show it, not that the behavior is absent. No hidden screens are inferred.

| App | Mobbin attempt (2026-09-20) | Result | Official fallback consulted | Result |
| --- | --- | --- | --- | --- |
| Cash App | `https://www.mobbin.com/apps/cash-app` | 404 | `https://cash.app/` | 200 |
| Revolut | `https://www.mobbin.com/apps/revolut` | 404 | `https://www.revolut.com/` | 200 |
| Monzo | `https://www.mobbin.com/apps/monzo` | 404 | `https://monzo.com/` | 200 |
| Nubank | `https://www.mobbin.com/apps/nubank` | 404 | `https://nubank.com.br/` | 200 |
| Wise | `https://www.mobbin.com/apps/wise` | 404 | `https://wise.com/` | 200 |
| Robinhood | `https://www.mobbin.com/apps/robinhood` | 404 | `https://robinhood.com/us/en/` | 200 |
| Coinbase | `https://www.mobbin.com/apps/coinbase` | 404 | `https://www.coinbase.com/` | 200 |
| Phantom | `https://www.mobbin.com/apps/phantom` | 404 | `https://phantom.com/` | 200 |
| Mercury | `https://www.mobbin.com/apps/mercury` | 404 | `https://mercury.com/` | 200 |
| Copilot | `https://www.mobbin.com/apps/copilot` | 404 | `https://www.copilot.money/` | 200 |

Per-app analysis follows. "Capability reading" is what the consulted page actually states; it is not evidence of a screen.

### Cash App — `https://cash.app/`

- **Source/access:** official marketing page only; Mobbin 404.
- **Navigation model:** not established (only the public website's product navigation is visible).
- **Home hierarchy:** not established. The page leads with "The way money should work", then benefit and product blocks.
- **Balance and change:** not established.
- **Action grammar:** offer-level only — "Sending money is fast, free, and made for you", "Save for your goals", "Deposit your paychecks". No in-app entry, review, or confirm behavior is shown.
- **Activity and pending:** not established.
- **Motion:** not established.
- **Capability reading:** one app presents send, spend, card, save, invest, bitcoin, pay-over-time, and taxes as a flat capability roster; savings yield ("up to 3.5% savings interest") is framed as a benefit of a program, not as a screen.

### Revolut — `https://www.revolut.com/`

- **Source/access:** official marketing page only; Mobbin 404.
- **Navigation model:** not established.
- **Home hierarchy:** not established. The page is organized around plan tiers and capability blocks ("Banking & Beyond", "Your salary, reimagined", "Life, meets savings", "Elevate your spend", "Explore 5,000+ stocks and ETFs").
- **Balance and change:** not established. Rate copy describes balances above/below a threshold and a blended rate, which is per-product interest framing, not a Home balance display.
- **Action grammar:** offer-level only ("send money to 160+ countries", "hold up-to 36 currencies in app", "sort your salary automatically"). No in-app flow is shown.
- **Activity and pending:** not established.
- **Motion:** not established.
- **Capability reading:** a multi-currency account wraps many capabilities; savings rate (up to 4% AER, paid daily) and a currency count are headline facts.

### Monzo — `https://monzo.com/`

- **Source/access:** official marketing page only; Mobbin 404.
- **Navigation model:** not established.
- **Home hierarchy:** not established as an app layout; the site catalogues by product category (Current accounts, Savings, Credit, Investments, Pensions, Homeownership) — the product-catalogue shape Home's overview deliberately avoids.
- **Balance and change:** not established.
- **Action grammar:** descriptive only — "Your salary sorted into Pots. Your spare change turned into savings."
- **Activity and pending:** not established.
- **Motion:** not established.
- **Capability reading:** containers are the organizing idea: Pots hold organized money ("Organise with Pots"), and savings rate (up to 3.65% AER) is stated as a product fact.

### Nubank — `https://nubank.com.br/`

- **Source/access:** official marketing page only (Portuguese), Mobbin 404.
- **Navigation model:** not established.
- **Home hierarchy:** not established; the page frames "for each moment, a different Nubank" and leads with the card.
- **Balance and change:** not established.
- **Action grammar:** container-level only — the page lists "Caixinhas" with a goal-organization description ("guarde dinheiro de maneira organizada de acordo com seus objetivos"; boxes that organize money by goal).
- **Activity and pending:** not established.
- **Motion:** not established.
- **Capability reading:** card, account, loans, and goal boxes; a category product roster presented as moments. This is the second datapoint, after Monzo, that containers/categories are a common organization device — and both are also languages/regional examples, relevant to Home's six-language and multi-currency future.

### Wise — `https://wise.com/`

- **Source/access:** official marketing page only; Mobbin 404.
- **Navigation model:** not established.
- **Home hierarchy:** not established.
- **Balance and change:** not established.
- **Action grammar:** **partially established at the public-calculator level.** The page itself renders a send-money calculator: "You send exactly USD", "Recipient gets EUR", "Arrives Today - in seconds", "Total fees Included in USD amount 5.47 USD", plus "An exchange rate won't change. Lock in exactly what your recipient will get for up to 24 hours." The in-app send flow itself is not established.
- **Activity and pending:** partially established as marketing copy — "74% of transfers arrive in under 20 seconds, and 95% in a day." No in-app pending surface is shown.
- **Motion:** not established.
- **Capability reading:** "150+ countries, 40 currencies, one account"; send, receive, spend, and hold are one account story. This is the closest consulted analogue to Home's review facts: amount, recipient amount, rate, fee, and arrival stated together before committing.

### Robinhood — `https://robinhood.com/us/en/`

- **Source/access:** official marketing page only; Mobbin 404.
- **Navigation model:** not established.
- **Home hierarchy:** not established. The page currently leads with "Agentic Trading" and an "Agentic Credit Card", then trading tools and portfolio handling.
- **Balance and change:** not established.
- **Action grammar:** descriptive only. "Give your agent a dedicated Robinhood account to trade in, then monitor activity and performance right in the app" mentions monitoring, not a move-money grammar.
- **Activity and pending:** "monitor activity" is stated as a capability of an agent account; no pending or status handling is shown.
- **Motion:** not established.
- **Capability reading:** trading-first positioning ("24/5 Commission-Free Stock Trading & Investing") with managed portfolios ("Your portfolio, handled by the pros").

### Coinbase — `https://www.coinbase.com/`

- **Source/access:** official marketing page only; Mobbin 404.
- **Navigation model:** not established.
- **Home hierarchy:** not established; the page is a discovery and trading surface ("Explore millions of tokens and stocks, all in one place", "Trade stocks around the clock").
- **Balance and change:** not established.
- **Action grammar:** offer-level only (trade, stake, earn, membership tiers).
- **Activity and pending:** not established.
- **Motion:** not established.
- **Capability reading:** the strongest example of capability sprawl: trading, stocks, Coinbase One membership (zero fees), Coinbase Wealth, and a credit card (up to 4% Bitcoin back). A Home overview that copied this shape would become a promotional catalogue.

### Phantom — `https://phantom.com/`

- **Source/access:** official marketing page only; Mobbin 404.
- **Navigation model:** not established.
- **Home hierarchy:** not established; the page leads with trading ("Where the world trades", "Your home for trading crypto, predictions, perps, and more").
- **Balance and change:** not established.
- **Action grammar:** named sections, at marketing level — "Move Money: One home for your money. Send money in seconds. Even pay friends." and "Spend, Send, & Save". The in-app flow is not shown.
- **Activity and pending:** not established.
- **Motion:** not established.
- **Capability reading:** a wallet presents money movement and spending alongside trading and perps; "Move Money" as a named section supports treating movement as a first-class surface, but not any specific layout.

### Mercury — `https://mercury.com/`

- **Source/access:** official marketing page only; Mobbin 404.
- **Navigation model:** not established as an app navigation; the page does describe a universal search bar for "payments, transfers, and more — all from one universal search bar".
- **Home hierarchy:** not established.
- **Balance and change:** not established.
- **Action grammar:** task-level copy — "Tackle banking tasks in seconds", "Send no-fee USD payments around the globe", "create free invoices". No entry/confirm flow is shown.
- **Activity and pending:** not established.
- **Motion:** not established.
- **Capability reading:** "Everything you do with money. All in one place." organizes by money jobs (banking, cards and spend management, payments and invoicing, accounting) and makes yield a headline capability ("Earn up to 3.89% yield with Mercury Treasury").

### Copilot — `https://www.copilot.money/`

- **Source/access:** official marketing page only; Mobbin 404.
- **Navigation model:** not established.
- **Home hierarchy:** **page-level product description with mockups.** Copy and embedded mockups show a net-worth-first framing: "All your money, one screen", "$16,825 total balance", "3m balance change", and per-account rows with their own change and recency ("Charles Schwab, 8 hours ago, 0.15%"). The in-app screen is not verified.
- **Balance and change:** the balance-change vocabulary above is established at the marketing-page level: a total with a 3-month change, then accounts with change and recency.
- **Action grammar:** not established; the page is a tracking product, not a movement product.
- **Activity and pending:** **page-level product description.** "Start your day with a quick look at your spending line, pending refunds, and upcoming bills" — a spending-line surface that includes pending items. The in-app surface is not verified.
- **Motion:** not established.
- **Capability reading:** the only consulted app that organizes around tracked money and net worth rather than movement; it is the strongest reference for a "line" of recent activity and for pending money being visible without pretending it settled.

### Cross-app synthesis

- **Capability clusters.** Every consulted page organizes around the same small set of money jobs: move (send/receive/transfer), spend (card), save/earn, invest/trade, and borrow/credit. Home's fund → save → invest → borrow is the same shape; the difference is that Home's money is thin on-chain money and its trust problem is arithmetic, not capability.
- **Move-money prominence.** Movement is first-class nearly everywhere (Wise's calculator, Phantom's "Move Money", Cash App's send framing, Mercury's payments). Home should keep movement as a primary action, but paired with a deliberate destination and an exact review rather than a generic "send" assumption.
- **Wise-like review facts.** The one public surface that exposes a real review vocabulary — amount, recipient amount, rate, fee, arrival — is Wise's page calculator. The pattern worth taking is *stating the exact committed facts together before the commit*. The exploration's review step does this with the facts it can state truthfully (amount, from, to + rate, network, and net position after = unchanged) and does not invent a fee or an arrival promise an on-chain deposit cannot make.
- **Status evidence rather than celebration.** No consulted page establishes in-app pending/failed/unknown handling. Copilot's copy is the only mention of pending at all ("pending refunds"), and Wise's copy is about arrival timing. Home's status grammar (explicit status chip, balances unchanged while pending, no auto-retry, deliberate retry only for failed) is a Home decision, not a copied pattern.
- **Containers and categories help organization.** Monzo's Pots and Nubank's Caixinhas are the clearest examples: money is grouped into named containers, and the container — not a repeated total — is the organizing object. This supports keeping vault inventory one deliberate step behind Saved.
- **Capability sprawl is the default failure mode.** Coinbase, Cash App, and Revolut all present long product catalogues. On a Home overview that becomes a promotional wall; the exploration keeps unused products in a quiet Explore destination or an "More" chapter instead.
- **Motion is not established.** No consulted source verifies in-app motion behavior; marketing-page motion was not used as evidence.

### Where Home should diverge

- **State net versus available as the truth, not as a marketing number.** None of the consulted pages distinguish net position from spendable money the way Home must (cash, saved, debt, completeness).
- **Keep the next actions narrow.** Two contextual actions, not a catalogue. Unused products stay findable and quiet.
- **Treat recovery as a product surface.** A truthful receipt, an explicit status, and one safe next step; no promotional or celebratory copy on money movement.
- **Do not put yield, borrow, or capability prompts on the overview.** Rates are reported facts with provenance, available where the money lives.

**Limitation of this ledger.** No in-app screen was verified for any of the ten apps in this run. Every interface-level claim is either marked `not established` or explicitly labeled as marketing-page-level evidence. A later pass with an authenticated Mobbin session or official App Store screenshot packs could verify the interface dimensions this run could not.

## The four directions

All four render the same facts, the same movement, and the same recovery path. They differ in information architecture, navigation, hierarchy, density, action model, and tone — not in palette or polish. Each direction is its own component and its own story set; the move-money surface is one shared implementation (`move-money.ts`, `move-money-view.tsx`) with a per-direction grammar.

### 1. Money Map (recommended)

**Thesis.** Home is a position directory. The overview states the net position and what is available to use, then lists positions — Cash, Saved, Debt, Activity — that each open their own detail. Vault-level inventory lives inside Saved, not on the overview, and every action is taken from the position it belongs to. Navigation: **Money · Activity · Explore**.

**Principle optimized.** Positional clarity: which portion of the money is which, before anything else. Money identity leads, actions follow their object.

**Accepted tradeoff.** Colder and less discovery-oriented. The first screen spends itself on precision rather than warmth or narrative, and a person who wants to browse products has to go to Explore.

**IA and navigation.** Persistent three-item bottom navigation (Money, Activity, Explore), matching Home's current three-item grammar. Money holds the overview plus Cash, Saved, and Debt details and the Move money workspace; Activity is a timeline destination; Explore holds the other products (Add money, Send or receive, Borrow, Invest) with an explicit "keeps its existing Home flow in this exploration" notice.

**Hierarchy and density.** Overview: net position (large) → separator → available to use, then saved with the weighted rate → primary "Move money" plus secondary "Add money" → positions list with one line of context each (Cash: available; Saved: amount in N vaults; Debt: nothing owed; Activity: entry count). No vault inventory on the overview. Medium density; details carry the facts.

**Action model.** Move money is a destination → amount → review → pending → result workspace entered from the position it belongs to: "Move money" from the overview, "Add" from a vault row. Nothing is preselected by rate, and the destination screen says so. Review states amount, from (available to use), to with the vault's own rate, network (Base 8453), and net position after — unchanged. Failed can be deliberately retried with the same vault and amount; unknown cannot be retried and routes to Activity; pending says nothing has moved.

**Tone.** Clinical, exact, quiet: facts, not advice.

**Challenges the assumption** that every product module and every vault must be visible on Home's overview with equal billing. It also refuses the "balance-first versus activity-first" binary by making Activity a first-class but separate destination rather than the organizing surface.

**What a person notices first:** net position and available to use. **What gets easier:** reading which money is usable and taking the action attached to a position. **What moves into detail:** vault inventory, per-vault rates, reconciliation arithmetic, older activity.

### 2. Money Journal

**Thesis.** Home is a dated journal. Today leads with a compact position line, any entry that is not finished, and dated receipts; Money is a short statement; the full ledger of entries is one deliberate step away rather than a permanent surface. Navigation: **Today · Money · Explore**.

**Principle optimized.** Chronology and unresolved movement: what happened, in order, and what has not resolved yet. Time is the index.

**Accepted tradeoff.** Composition is one step away. The overview is the journal, so net-versus-available context is compact (a fact list, not a hero), and the money-position statement is a second tap. Hierarchy has to work harder to keep position legible.

**IA and navigation.** Three tabs placed directly under the title (the date is the primary surface). Today: compact position line, "New deposit entry" and "All entries", any open entry with its status and safe next step, then today's receipts and an "Earlier" section. Money: statement facts (net, available, saved, weighted rate, debt, "how it is counted"), a new-entry button, and the vault list. Entries: unresolved first, then receipts grouped by day.

**Hierarchy and density.** Dense, table-like rows grouped by date. No hero balance on Today; the money statement lives on Money. Receipts are the dominant object.

**Action model.** The same shared flow with journal grammar: destination → amount → "Draft review" → submit → pending → result. The confirmed outcome reads as a receipt ("Entry recorded: $100.00") rather than a celebration; a failed entry says nothing retried and offers "Redo this entry"; an unknown entry says to check Today before submitting again and offers no retry.

**Tone.** Chronological, quieter, slightly narrative: entries and receipts, not products and balances.

**Challenges the assumption** that Home is balance-first. Here activity is the opening surface and the position is compact context — the opposite arrangement from Money Map.

**What a person notices first:** the day's entries and any open entry. **What gets easier:** understanding sequence and whether something is still unresolved. **What moves into detail:** the position statement and vault inventory (Money tab), older receipts (Entries).

### 3. Money Desk

**Thesis.** Home is a task-first workspace. Move is the first tab, and the deposit is one explicit amount → review → result workspace with a visible step rail and an inline destination choice. Money is a facts ledger where vault rates appear as reported facts with provenance, and Activity is a work log. Navigation: **Move · Money · Activity**.

**Principle optimized.** Doing the task: the fewest ambiguous steps to enter an action and the clearest read of its state.

**Accepted tradeoff.** Weaker passive overview and more utilitarian. The app opens on a workspace rather than a statement, so a person who only wants to check their money takes one extra tap, and the tone is closer to an operator console than a calm statement.

**IA and navigation.** Title plus tab bar in the header. Move is the workspace: it starts at the amount step with the destination chosen inline in the same panel, and the step rail (Amount → Review → Result) is visible through the flow. Money is the facts ledger plus vaults plus "Where these numbers come from" provenance (vault data read time, wallet on Base 8453). Activity is the log: Needs attention → In progress → Settled.

**Hierarchy and density.** Move: step rail, one amount field, explicit vault rows with a "Choose" action. Money: net position hero, fact list (available, saved, weighted rate, debt), reconciliation line, vault rows, provenance. Activity: attention cards first, then in-progress and settled lists. Dense and explicit.

**Action model.** Amount first, destination inline, review facts, then submit. A pending deposit states that balances are unchanged; a failed one offers "Deposit again"; an unknown one cannot be retried and says why ("sending it again could move the money twice").

**Tone.** Operational and verb-forward: work log, needs attention, in progress, settled, deposit into a vault.

**Challenges the assumption** that Home must open on an overview. Verbs, not products, are the primary navigation, and the position is available but not first.

**What a person notices first:** the amount field and the step rail — the task. **What gets easier:** completing a deposit without hunting for the action. **What moves into detail:** the position statement and vault inventory (Money tab), history (Activity log).

### 4. One Home

**Thesis.** Home is a single scroll of financial chapters — Position, Move, Saved, Activity, More — with a Jump-to index and no persistent product tabs. Each chapter carries its own contextual action, Activity is a chapter rather than a destination, and moving money is a deliberate page takeover.

**Principle optimized.** Continuity: one page, no navigation model to learn, everything findable by scroll or an accessible jump link.

**Accepted tradeoff.** Scroll and deep-navigation efficiency. Reaching the fourth chapter means scrolling or jumping, the page grows with every added product, and returning from the takeover restores focus to the Move chapter rather than to an arbitrary scroll position.

**IA and navigation.** A "Jump to chapter" anchor list is the only navigation; chapter headings are anchors, and jump links work natively (no JavaScript required). There is no bottom tab bar. Position, Move, and Saved each carry a contextual action; Activity is informational, and More routes out to the existing flows for other products.

**Hierarchy and density.** Chapter cards with a heading, facts, and at most one action each. The longest single page of the four; repetition is avoided by giving each chapter a distinct job.

**Action model.** Move money is a page takeover launched from the Position chapter, the Move chapter, or a vault row in Saved. On return, focus goes back to the Move chapter heading. An unknown outcome links to the Activity chapter; the Activity chapter shows unresolved entries with their status in place.

**Tone.** Calm and editorial: chapters, positions, and an index; less transactional than the other three.

**Challenges the assumption** that Home needs persistent tabs at all. It also challenges "Activity is a destination" (it is a chapter) and "the home surface is one screen" (it is a document).

**What a person notices first:** the jump index, then the position chapter. **What gets easier:** understanding the whole home at once without switching contexts. **What moves into detail:** nothing is hidden behind navigation, but depth (older entries, vault details, other products) needs a longer scroll or a jump.

### Comparison board

`Explorations/Home reimagined/Comparison` renders all four directions side by side at real device width (390×844 each) with identical facts, labels for each navigation model and action model, and two stories: funded, and one deposit pending. The four shells are rendered `inert` inside the board so four complete page shells do not publish duplicate landmarks and four competing `h1` headings to assistive technology; each direction has its own reviewable story for the accessible tree.

**Structural challenge summary.** Money Map challenges equal billing for products and vaults on the overview. Money Journal challenges balance-first composition. Money Desk challenges overview-first composition. One Home challenges persistent tabs themselves. Together they test the four structural assumptions Home currently makes: that Home is an overview, that balances open the app, that products are the navigation, and that Home is one screen.

## Recommendation

**Advance Money Map**, importing one thing from Money Journal: its unresolved-movement framing and receipt clarity. Keep **one grammar: Money · Activity · Explore**. Money Map best answers the customer job — it states net versus available immediately, refuses to repeat totals or vault inventory, and attaches each action to the position it changes, while keeping movement deliberate and recovery honest.

**Why Money Map over the others.** Money Journal is the strongest competing composition and the best source of unresolved-entry framing, but its money statement is one step away, which weakens the 5-second test. Money Desk answers "do the task" well but weakens the passive orientation moment and reads utilitarian. One Home is the most coherent single document but pays a scroll and deep-navigation tax that gets worse as Home grows.

**Risks.**

- It could collapse into #661's ledger-with-labels: a list of product names wearing position chrome. The directory only works if each row states a distinct, truthful fact and opens a detail with its own action.
- The directory can feel clinical. Precision without warmth risks reading as an accounting tool, especially on the empty and debt states.
- Discovery may become too quiet. Explore as the only home for other products risks being overlooked, and unused vaults are hidden behind Saved.

**What survives from #661.** The arithmetic and completeness semantics (loading ≠ zero, partial totals stay incomplete, debt verified before it is subtracted), the combined APY with its provenance and staleness rules, the money-dialog review facts and confirmed-only balance updates, the pinned fixtures, and the practice of reviewing the component in Storybook before Home. Those were preserved deliberately rather than rebuilt.

**What changes.** The information architecture (the three-item grammar is re-purposed: products move to Explore). The hierarchy (net versus available before product inventory). Navigation (positions open their own detail; Activity is a destination). Action placement (actions are taken from the position they belong to). The role of Activity (a first-class truth surface rather than a ledger appended to Home). And what is removed: repeated totals on every surface, vault inventory on the overview, and Cash-out emphasis.

**First production step after Jesse approves.** Adapt the selected direction's Home → Save → Activity at the existing Home boundary only — prove an ordinary funded state, a confirmed deposit, a receipt, and unknown-outcome recovery before any broader shell or token migration. This is not a rollout; #655 remains the adoption issue and owns the full state matrix, connected journey, and browser validation in Home.

**Dependencies.** None proposed. No new runtime dependency, font, or icon package. The exploration uses the existing system sans-serif stack, `lucide-react` icons already in the repository, and owned wrappers (`Button`, `Card`, `Item`, `Field`, `Input`, `Alert`, `MoneyTicker`, `HomeMark`, `shellContentFrameClassName`).

## Rendered proof inventory

**49 stories** under `Explorations/Home reimagined/*`, verified by enumerating the running Storybook index on 2026-09-20:

| Group | Stories |
| --- | --- |
| `Explorations/Home reimagined/Money Map` | 16 |
| `Explorations/Home reimagined/Money Journal` | 10 |
| `Explorations/Home reimagined/Money Desk` | 11 |
| `Explorations/Home reimagined/One Home` | 10 |
| `Explorations/Home reimagined/Comparison` | 2 |

Every story meta declares an explicit stable `id`. Manager and canvas paths are deployment-relative to the Storybook origin (local default `http://127.0.0.1:6006`):

- manager: `/?path=/story/<story-id>`
- canvas: `/iframe.html?id=<story-id>&viewMode=story`

Review composition is pinned per story: 390×844 CSS pixels for mobile, 1280×800 for the recommended desktop story.

### Money Map (recommended) — key stories

| Surface | Stable story ID | Manager path | Canvas path |
| --- | --- | --- | --- |
| Home, funded | `explorations-home-reimagined-money-map--home` | `/?path=/story/explorations-home-reimagined-money-map--home` | `/iframe.html?id=explorations-home-reimagined-money-map--home&viewMode=story` |
| Move money, at review | `explorations-home-reimagined-money-map--move-money` | `/?path=/story/explorations-home-reimagined-money-map--move-money` | `/iframe.html?id=explorations-home-reimagined-money-map--move-money&viewMode=story` |
| Activity | `explorations-home-reimagined-money-map--activity` | `/?path=/story/explorations-home-reimagined-money-map--activity` | `/iframe.html?id=explorations-home-reimagined-money-map--activity&viewMode=story` |
| Desktop home, 1280×800 | `explorations-home-reimagined-money-map--desktop-home` | `/?path=/story/explorations-home-reimagined-money-map--desktop-home` | `/iframe.html?id=explorations-home-reimagined-money-map--desktop-home&viewMode=story` |

Recommended-direction state set:

| State | Stable story ID | Manager path |
| --- | --- | --- |
| Loading | `explorations-home-reimagined-money-map--loading` | `/?path=/story/explorations-home-reimagined-money-map--loading` |
| Verified empty | `explorations-home-reimagined-money-map--verified-empty` | `/?path=/story/explorations-home-reimagined-money-map--verified-empty` |
| Partial / saved unavailable | `explorations-home-reimagined-money-map--partial-unavailable` | `/?path=/story/explorations-home-reimagined-money-map--partial-unavailable` |
| Pending movement (home) | `explorations-home-reimagined-money-map--pending-movement` | `/?path=/story/explorations-home-reimagined-money-map--pending-movement` |
| Failed recovery (home) | `explorations-home-reimagined-money-map--failed-recovery` | `/?path=/story/explorations-home-reimagined-money-map--failed-recovery` |
| Unknown outcome (home) | `explorations-home-reimagined-money-map--unknown-outcome` | `/?path=/story/explorations-home-reimagined-money-map--unknown-outcome` |
| Debt position | `explorations-home-reimagined-money-map--debt-position` | `/?path=/story/explorations-home-reimagined-money-map--debt-position` |
| Long/localized content | `explorations-home-reimagined-money-map--long-localized-content` | `/?path=/story/explorations-home-reimagined-money-map--long-localized-content` |
| Long/localized Activity | `explorations-home-reimagined-money-map--activity-long-localized-content` | `/?path=/story/explorations-home-reimagined-money-map--activity-long-localized-content` |
| Move money, pending | `explorations-home-reimagined-money-map--move-money-pending` | `/?path=/story/explorations-home-reimagined-money-map--move-money-pending` |
| Move money, confirmed | `explorations-home-reimagined-money-map--move-money-confirmed` | `/?path=/story/explorations-home-reimagined-money-map--move-money-confirmed` |
| Move money, failed recovery | `explorations-home-reimagined-money-map--move-money-failed-recovery` | `/?path=/story/explorations-home-reimagined-money-map--move-money-failed-recovery` |

Each state story's canvas path is `/iframe.html?id=<story-id>&viewMode=story` with the same stable ID.

### Money Journal — key stories

| Surface | Stable story ID | Manager path | Canvas path |
| --- | --- | --- | --- |
| Today, funded | `explorations-home-reimagined-money-journal--home` | `/?path=/story/explorations-home-reimagined-money-journal--home` | `/iframe.html?id=explorations-home-reimagined-money-journal--home&viewMode=story` |
| New entry, at review | `explorations-home-reimagined-money-journal--move-money` | `/?path=/story/explorations-home-reimagined-money-journal--move-money` | `/iframe.html?id=explorations-home-reimagined-money-journal--move-money&viewMode=story` |
| Entries (ledger) | `explorations-home-reimagined-money-journal--activity` | `/?path=/story/explorations-home-reimagined-money-journal--activity` | `/iframe.html?id=explorations-home-reimagined-money-journal--activity&viewMode=story` |
| Entries, settled only | `explorations-home-reimagined-money-journal--activity-settled-only` | `/?path=/story/explorations-home-reimagined-money-journal--activity-settled-only` | `/iframe.html?id=explorations-home-reimagined-money-journal--activity-settled-only&viewMode=story` |

Remaining journal states: `--loading`, `--verified-empty`, `--partial-unavailable`, `--move-money-pending`, `--move-money-confirmed`, `--move-money-failed-recovery`.

### Money Desk — key stories

| Surface | Stable story ID | Manager path | Canvas path |
| --- | --- | --- | --- |
| Move workspace, amount step | `explorations-home-reimagined-money-desk--home` | `/?path=/story/explorations-home-reimagined-money-desk--home` | `/iframe.html?id=explorations-home-reimagined-money-desk--home&viewMode=story` |
| Move workspace, review | `explorations-home-reimagined-money-desk--move-money` | `/?path=/story/explorations-home-reimagined-money-desk--move-money` | `/iframe.html?id=explorations-home-reimagined-money-desk--move-money&viewMode=story` |
| Activity log | `explorations-home-reimagined-money-desk--activity` | `/?path=/story/explorations-home-reimagined-money-desk--activity` | `/iframe.html?id=explorations-home-reimagined-money-desk--activity&viewMode=story` |
| Money facts ledger | `explorations-home-reimagined-money-desk--money-facts` | `/?path=/story/explorations-home-reimagined-money-desk--money-facts` | `/iframe.html?id=explorations-home-reimagined-money-desk--money-facts&viewMode=story` |
| Unknown outcome | `explorations-home-reimagined-money-desk--move-money-unknown-outcome` | `/?path=/story/explorations-home-reimagined-money-desk--move-money-unknown-outcome` | `/iframe.html?id=explorations-home-reimagined-money-desk--move-money-unknown-outcome&viewMode=story` |

Remaining desk states: `--loading`, `--verified-empty`, `--partial-unavailable`, `--move-money-pending`, `--move-money-confirmed`, `--move-money-failed-recovery`.

### One Home — key stories

| Surface | Stable story ID | Manager path | Canvas path |
| --- | --- | --- | --- |
| Chapters, top of scroll | `explorations-home-reimagined-one-home--home` | `/?path=/story/explorations-home-reimagined-one-home--home` | `/iframe.html?id=explorations-home-reimagined-one-home--home&viewMode=story` |
| Move takeover, at review | `explorations-home-reimagined-one-home--move-money` | `/?path=/story/explorations-home-reimagined-one-home--move-money` | `/iframe.html?id=explorations-home-reimagined-one-home--move-money&viewMode=story` |
| Activity chapter | `explorations-home-reimagined-one-home--activity` | `/?path=/story/explorations-home-reimagined-one-home--activity` | `/iframe.html?id=explorations-home-reimagined-one-home--activity&viewMode=story` |
| Saved chapter | `explorations-home-reimagined-one-home--saved-chapter` | `/?path=/story/explorations-home-reimagined-one-home--saved-chapter` | `/iframe.html?id=explorations-home-reimagined-one-home--saved-chapter&viewMode=story` |

Remaining One Home states: `--loading`, `--verified-empty`, `--partial-unavailable`, `--move-money-pending`, `--move-money-confirmed`, `--move-money-failed-recovery`.

### Comparison board

| Surface | Stable story ID | Manager path | Canvas path |
| --- | --- | --- | --- |
| Four homes, one set of facts | `explorations-home-reimagined-comparison--homes` | `/?path=/story/explorations-home-reimagined-comparison--homes` | `/iframe.html?id=explorations-home-reimagined-comparison--homes&viewMode=story` |
| Same board, one pending deposit | `explorations-home-reimagined-comparison--homes-with-pending-movement` | `/?path=/story/explorations-home-reimagined-comparison--homes-with-pending-movement` | `/iframe.html?id=explorations-home-reimagined-comparison--homes-with-pending-movement&viewMode=story` |

### Storybook limitations and blast radius

- Storybook proves fixture-backed component composition and component interactions under deterministic states and review viewports. It cannot prove Next routing/history, app-level scrolling or focus restoration, browser Back integration, wallet/provider behavior, physical keyboard behavior, or Safari behavior.
- The comparison board renders four complete shells with `inert`; its accessible tree is intentionally not a review target. Each direction's own stories review the accessibility tree.
- The exploration does **not** change any production route, component, token, shell, data model, or money path. The only new code is `apps/web/client/explorations/home-reimagined/**`, which is imported by no production module (verified by repository-wide grep), and the Storybook group is `Explorations/*`, clearly separate from production guidance.
- Real money was not tested anywhere in this exploration: no wallet, provider, funded authority, or money execution is involved; the fixture executor resolves on the next microtask from fixed fixtures.

## Implementation inventory

| File | Role |
| --- | --- |
| `apps/web/client/explorations/home-reimagined/money-state.ts` | Exploration-only money model: slices with `loading`/`available`/`unavailable`, `BigInt` arithmetic, net position only when complete, movement recording and settle-once, activity presentation, unresolved-movement framing. Reuses production helpers (`summarizeSavingsPortfolio`, `getSavingsRateState`, `presentActivityTransferRow`, `formatUsdStablecoinAmount`, `formatPresentationFiat`). |
| `apps/web/client/explorations/home-reimagined/move-money.ts` | Shared move-money state machine: destination → amount → review → pending → result, `parseUsdcAmount` validation, quick amounts, deliberate retry, no auto-submit, no auto-retry. |
| `apps/web/client/explorations/home-reimagined/move-money-view.tsx` | Shared move-money surface; per-direction grammar controls destination screen versus inline, step rail, and panel versus receipt tone. |
| `apps/web/client/explorations/home-reimagined/parts.tsx` | Shared atoms: exact money value via `MoneyTicker`, fact list, truthful status chip, movement notice, activity row, chapter heading. |
| `apps/web/client/explorations/home-reimagined/money-map.tsx` | Direction 1: Money · Activity · Explore position directory. |
| `apps/web/client/explorations/home-reimagined/money-journal.tsx` | Direction 2: Today · Money · Explore dated journal. |
| `apps/web/client/explorations/home-reimagined/money-desk.tsx` | Direction 3: Move · Money · Activity task workspace. |
| `apps/web/client/explorations/home-reimagined/one-home.tsx` | Direction 4: single scroll with Jump-to chapters. |
| `apps/web/client/explorations/home-reimagined/comparison.tsx` | Side-by-side comparison board. |
| `apps/web/client/explorations/home-reimagined/fixtures.ts` | Fixed clock, funded/loading/empty/partial/unavailable/debt/pending/failed/unknown/confirmed/long-localized states. |
| `apps/web/client/explorations/home-reimagined/story-viewports.ts` | 390×844 and 1280×800 review viewports. |
| `apps/web/client/explorations/home-reimagined/money-state.test.ts` | 27 tests: position arithmetic, completeness, loading ≠ zero, verified empty, large/localized exclusion, settle-once, pending/failed/unknown never move, unresolved framing and its ledger context, and the rule that a newer retry for the same vault and amount supersedes the failure it retried while both remain in the ledger. |
| `apps/web/client/explorations/home-reimagined/move-money.test.tsx` | 18 tests: exact confirmed movement, pending honesty, unknown refuses retry, failed deliberate retry, validation limits including the empty amount, Back/Cancel, inline destination, page takeover, loading overview semantics, no-vault-list dead end, receipt contents, and the Activity retry that opens the prefilled workspace and clears the notice once it confirms. |

Amount notation is deliberate and differs by surface: customer-facing action and review amounts read as currency (`$100.00`) because that is the money a person is choosing to move, while Activity rows and the receipt ledger read as token notation (`100.00 USDC`) because they record what moved on Base — the same notation the production activity feed already uses, and never a signed debit for a movement between the person's own slices.

One implementation note for a future owned variant: the shared `Badge` destructive variant measures 3.98:1 at 12px on the card surface, so `parts.tsx` uses an exploration-owned status chip (4.76:1 on the card surface) for failed movement. This is a candidate for an owned variant, not a change made here.

## Validation and evidence

- **Documentation and source evidence:** all Markdown file paths and relative links in this document resolve; the `docs/ui-direction.md` link target exists; the 49 story IDs were enumerated from the running Storybook index (`/index.json`) on 2026-09-20 rather than transcribed by hand; the public Mobbin catalog, ten direct app URL attempts, and ten official fallbacks were consulted or re-checked as recorded above.
- **Focused implementation tests:** `bun test --max-concurrency 1 client/explorations/home-reimagined/money-state.test.ts client/explorations/home-reimagined/move-money.test.tsx` — 45 passed, 0 failed, 222 expect() calls (27 model + 18 interaction; includes the retry-supersedes-failure rules, the Activity retry path, loading semantics, and the empty-amount validation).
- **Delivery gates:** final-head `bun check` passed (1,517 tests passed, 43 skipped; gates, lint, typecheck, and production build passed), and `bun run --cwd apps/web build-storybook` completed successfully with 49 unique exploration story IDs.
- **Not verified by this document:** integrated Next routing/history, browser Back, wallet/provider behavior, physical keyboard behavior, Safari, real money, and any claim that a direction is approved.

## Decision requested

Jesse selects **Money Map** as rendered, a **hybrid** (for example Money Map with Money Journal's unresolved-entry framing and receipt tone), or another direction. Production adoption stays with #655 after selection; the recommendation above names the first production step so the selected direction can be proven at the existing Home → Save → Activity boundary before any broader shell or token migration.
