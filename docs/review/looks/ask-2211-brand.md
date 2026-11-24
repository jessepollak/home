# Look: ask/2211-brand (merged in #2323, 694c8f3)

What changed: the operator console shows the saved brand name instead of a hard-coded `home`. It appears in the desktop sidebar header, the mobile top bar, and under the "Sections" title in the mobile drawer.

Checked 1440×900 and 390×844, before and after, for three states: no brand saved, "Acme Money" saved, and settings unreadable.
- Saved: "Acme Money" sits on the same baseline and at the same size as the old `home`. The nav doesn't move, and the mobile menu button stays where it was.
- Drawer: the saved name is a centred, muted line under "Sections" and lines up with the title. The nav list below doesn't move.
- Default and unreadable: the console shows `Home`, the same name customer pages use, instead of lowercase `home`.
- global-error is unchanged and keeps the default on purpose.

Nothing jumps and nothing overflows at either width. The captures are in #2323's Preview table.

Not seen on production: signed out, production `/admin` stops at the access-password gate, and no authorized operator session was available for a read-only look at the console after the merge.
