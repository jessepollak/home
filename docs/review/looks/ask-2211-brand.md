# Look: ask/2211-brand (PR #2323)

What changed: the operator console's sidebar header (desktop) and top bar (mobile) show the saved brand name instead of a hard-coded `home`.

Checked 1440×900 and 390×844, before and after, for three states: no brand saved, "Acme Money" saved, and settings unreadable.
- Saved: "Acme Money" sits on the same baseline and at the same size as the old `home`. The nav doesn't move, and the mobile menu button stays where it was.
- Default and unreadable: show `Home`, the same name customer pages use, instead of lowercase `home`.
- global-error is unchanged and keeps the default on purpose.

Nothing jumps and nothing overflows at either width. The captures are in the PR's Preview table.

Round 2 (fe375df36): the mobile sections drawer now shows the saved name ("Acme Money") as a centred, muted line under the "Sections" title. It's aligned with the title, the nav list below doesn't move, and the default and unreadable states show "Home".
