# Look: ask/2319-products-account (#2319 items 3 and 6)

Captures: Products confirm from the `Operator/Products and markets` → `MixedReview` story (saved Save exit-only; the operator turns Save on and Borrow to Exit only, then Save settings), and `/account` on the local fixture server with a signed `home-session` cookie, both with pinned agent-browser at 390 and 1280. Pictures are in the PR body.

- Products before 390/1280: "Turn on new entries?" lists Save and its three vaults only; Borrow going to Exit only and its five markets going Reducing only are not mentioned.
- Products after 390/1280: "Review changes" lists every change as `<name> → <new state> — <customer effect>`: Save → On, Borrow → Exit only, three vaults → Enabled, five markets → Reducing only. "Save changes" saves; Cancel writes nothing. The list scrolls inside the drawer at 390; the footer stays in view.
- `/account` signed in, before: lands on `/?account=signin` with the Sign in to Home sheet. After: lands on `/home?account=settings` with Account settings open. Signed out it still lands on the sign-in sheet. The after pictures predate the switch to a plain redirect after review; the landing is the same.
Bar: passes. Same Drawer and list as #2347; no new components; labels intact; nothing jumps.
