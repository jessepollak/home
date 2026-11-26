# Look: ask/admin-email (#2317) at b5ac80655

Captures: fixture server, pinned agent-browser. Email operator /admin at 390 and 1280; non-operator email at 390.

- Operator 1280: Admin shell, sidebar and Overview setup list aligned; labels intact. Same as the Base Account operator view.
- Operator 390: header with menu, Overview stacks cleanly, no overflow.
- Non-operator 390: lands on Home, no Admin content (fixture has no balances backend, hence the retry states).
- Only new screens: a brief check skeleton and a "Couldn't check Admin access." panel (not captured; read from source by r1).
Bar: passes. Nothing jumps; existing components.
