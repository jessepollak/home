# Regional and desktop shell proposal (#638)

Status: production-component Storybook proposal, not wired to product routes.

## Locked decisions represented

- Primary money actions are **Add money · Send · Cash out**. Each is a separate 44px-minimum intent target with equal visual treatment; provider selection and money authority remain downstream.
- First use aligns Country, Display currency and Language. Currency and language can then be explicit or independently return to **Use country default**. Country changes do not overwrite explicit choices.
- Primary navigation reference is **Home · Card · Invest**, with Account separate from the product destinations. Card content and behavior remain owned by #636.
- The components emit navigation and action callbacks only. They add no route, URL, persistence, provider, balance, formatting, authentication or money behavior, preserving the existing shell/history owners.

## Composition

Mobile keeps account access in the header, the three money intents below the balance, and three product destinations in fixed bottom navigation. Desktop uses a persistent left rail and a wider 7/5 content grid: balance, actions, local money and dollar products lead; local-yield state and Activity form the supporting column.

The deterministic stories cover GLOBAL, US, BR, NG and ID. Regional strings and amounts are presentation fixtures, not coverage or provider claims. The US fixture omits the local-yield proposal entirely because this design fixture does not establish whether that product is available or unavailable. Where present, local money, dollar-denominated products and local-yield availability are visibly separate. `available`, `unavailable` and `choose-country` are only proposal inputs; consuming work should map the shared capability model from #635 rather than duplicate it.

## Review references

- Home shell: `proposal-regional-home-shell--global` plus US, Brazil, Nigeria, Indonesia, intentional desktop, 320px German, 200% French, RTL, keyboard focus and reduced-motion exports.
- Account preferences: `proposal-regional-preferences--first-use-aligned-defaults` plus independent choices, country-change preservation, desktop, 320px German, 200% French, RTL, keyboard focus and reduced-motion exports.

## Remaining Jesse review decisions

- Final translated product copy and the language shown when GLOBAL is selected.
- Whether mobile Account access remains icon-only in the header or gains a persistent text label.
- Which integrated delivery leaf consumes the accepted proposal after #635 capability mapping and #636 Card details are ready.
