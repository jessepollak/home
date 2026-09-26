# Sheet and motion deferral ([#368](https://github.com/jessepollak/home/issues/368))

After [#804](https://github.com/jessepollak/home/pull/804) the shell renders at `/[...shell]` (`/dashboard` only redirects to `/home`), so the same method measures that route: build-manifest root files plus unique `[...shell]/page` client-reference chunks, gzip level 9.

| Measure | `main` (`e76eaf7`) | Deferred sheets, no `motion` |
| --- | ---: | ---: |
| Shell initial JS | 1,825,853 B | 1,478,491 B |
| Shell initial JS, gzip | 581,802 B | 474,715 B |
| Largest initial chunk, gzip | 194,189 B | 71,647 B |
| All client JS, gzip | 1,195,060 B | 1,187,792 B |

The Drawer-backed sheets (Send, Add money, Save, Borrow, transaction details, and sign-in) load through `deferSheet`; `motion` loads only when a pointer first enters the full Home mark, and the navigation indicator is a CSS transform. Base UI Combobox and floating-ui still reach the initial path through Account settings' `CountrySelect`, and `@adraffy/ens-normalize` through `client/transfers` → `shared/transfers/recipient-name`.
