# Balances — first-visit can’t load

Storybook group: `Explorations/Balances/Can't load` (`explorations-balances-cant-load`). Review board: `review-boards--balances-cant-load`.

- Candidates: `explorations-balances-cant-load--baseline-home`, `--baseline-cash`, `--baseline-investments`, `--quiet-home`, `--quiet-cash`, `--quiet-investments`, `--inline-home`, `--inline-cash`, `--inline-investments`.

Each story renders one balance hero (Home, Cash or Investments) after the first balances read failed and no snapshot has ever loaded. The candidates vary one axis, where the message and Try again sit relative to the figure region: A replaces the figure with the production `BalancesCantLoad` card, B keeps a muted figure-shaped bar with a muted line and a text Try again beneath, and C shows one row with the message and a trailing Try again. Production keeps A until Jesse selects ([#2045](https://github.com/jessepollak/home/issues/2045)).
