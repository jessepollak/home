# Look: ask/account-focus-return (#2345 follow-up)

Pinned `bun run ab`, fixture session on a local port. The header country status only appears for the GLOBAL region (no country), so for this check only the fixture server ran with `US` removed from the default region offer (a local edit, reverted, not committed) and `/api/balances` routed to the `GLOBAL` snapshot. Keyboard path: focus `[data-home-status]`, Enter (the popover focuses Open Account), Enter, then close with Escape or Done, and read `document.activeElement`.

Account settings is an in-shell panel, not a dialog, so Escape did nothing before this change and does nothing after it. Done and browser Back close it.

## Before (origin/main)

```
== 390 844 Escape
focused: "BUTTON Choose a country in Account to set how money is shown [data-home-status]"
in popover: "BUTTON Open Account"
account open: url="?account=settings" active="SECTION Account settings"
after Escape: url="?account=settings" active="SECTION Account settings"
== 390 844 Done
focused: "BUTTON Choose a country in Account to set how money is shown [data-home-status]"
in popover: "BUTTON Open Account"
account open: url="?account=settings" active="SECTION Account settings"
after Done: url="" active="BUTTON Account"
== 1280 800 Escape
focused: "BUTTON Choose a country in Account to set how money is shown [data-home-status]"
in popover: "BUTTON Open Account"
account open: url="?account=settings" active="SECTION Account settings"
after Escape: url="?account=settings" active="SECTION Account settings"
== 1280 800 Done
focused: "BUTTON Choose a country in Account to set how money is shown [data-home-status]"
in popover: "BUTTON Open Account"
account open: url="?account=settings" active="SECTION Account settings"
after Done: url="" active="BUTTON Account settings"
```

## After

```
== 390 844 Escape
focused: "BUTTON Choose a country in Account to set how money is shown [data-home-status]"
in popover: "BUTTON Open Account"
account open: url="?account=settings" active="SECTION Account settings"
after Escape: url="?account=settings" active="SECTION Account settings"
== 390 844 Done
focused: "BUTTON Choose a country in Account to set how money is shown [data-home-status]"
in popover: "BUTTON Open Account"
account open: url="?account=settings" active="SECTION Account settings"
after Done: url="" active="BUTTON Choose a country in Account to set how money is shown [data-home-status]"
== 390 844 profile/url
profile focused: "BUTTON Account"
profile open: url="?account=settings" active="SECTION Account settings"
profile after Done: url="" active="BUTTON Account"
url open: url="?account=settings" active="SECTION Account settings"
url after Done: url="" active="BUTTON Account" errors=0
== 1280 800 Escape
focused: "BUTTON Choose a country in Account to set how money is shown [data-home-status]"
in popover: "BUTTON Open Account"
account open: url="?account=settings" active="SECTION Account settings"
after Escape: url="?account=settings" active="SECTION Account settings"
== 1280 800 Done
focused: "BUTTON Choose a country in Account to set how money is shown [data-home-status]"
in popover: "BUTTON Open Account"
account open: url="?account=settings" active="SECTION Account settings"
after Done: url="" active="BUTTON Choose a country in Account to set how money is shown [data-home-status]"
== 1280 800 profile/url
profile focused: "BUTTON Account settings"
profile open: url="?account=settings" active="SECTION Account settings"
profile after Done: url="" active="BUTTON Account settings"
url open: url="?account=settings" active="SECTION Account settings"
url after Done: url="" active="BUTTON Account settings" errors=0
```

Browser Back from Account (opened from the status, 390): url="" active="Choose a country in Account to set how money is shown".

Result: closing Account now returns focus to the header status that opened it, which is re-rendered while Account is open. Opening from the profile control still returns focus to that control. Opening from `?account=settings` falls back to the profile control with no errors. No visual change.
