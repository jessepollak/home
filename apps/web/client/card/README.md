# Card surface contract

`CardExperience` is the provider-agnostic, unwired Card destination selected in #636. It accepts observed display state and injected actions; it does not issue a card, move money, fetch provider data, or add navigation.

- **Money:** `availableToSpend` is a card allocation sourced from an existing Home holding. `allocationLabel` must say that the amount remains included once in Home’s position model; integrations must not add it as a second holding.
- **Funding:** pass a production entry backed by the existing `MoneyModal` contract through `fundingEntry`. Authorization, review, dispatch, and settlement stay with the eventual card integration.
- **Secrets:** the surface never accepts PAN or CVV. `onOpenSecureDetails` crosses into a separately authenticated provider-held details view.
- **Identity:** use `reuse-accepted` only after the selected provider confirms it accepts the operator’s existing verification token. Otherwise use provider-hosted verification; Home does not collect identity documents.
- **Wallets:** `eligible` means setup may be checked, not that provisioning succeeded. Only a provider observation may set `provisioned`.
- **Activity:** the landing summary delegates row activation and “See all” through `onOpenActivity`. #637 owns canonical card events, deduplication, details, and recovery in Activity.
- **Failure:** an outage keeps the last observed balance and activity visible with its age while disabling card mutations. Support remains an injected operator/provider handoff.

The stories cover entry, verification, active/frozen/low-funds, virtual/physical/wallet variants, empty and card-event summaries, outage, 320/390/desktop, long content, 200% text, and reduced motion. Provider capabilities, exact limits, dispute ownership, secure-view mechanics, and card-allocation settlement remain delivery decisions after provider selection.
