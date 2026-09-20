# Oxlint migration parity inventory

Status: implementation design and executable parity inventory for issue #592.

## Goal and measured baseline

Home will replace ESLint with an Oxlint-only `bun run lint` command without weakening architecture, design-system, framework, or test contracts. The migration uses Bun 1.3.12, exact package pins, a checked-in JSONC configuration, direct Home-owned visitors where native Oxlint behavior is insufficient, and CLI/config canaries that fail if a path is ignored or a rule is absent.

Measured on the same checkout before migration:

| Run | Command | Wall time | Result |
| --- | --- | ---: | --- |
| Cold | `bun run lint` | 8.32s | pass |
| Warm | `bun run lint` | 6.84s | pass |
| Contract gates | `bun run gates` | 1.02s | 56 pass |
| Detached-class visitor corpus | `bun test apps/web/eslint/no-detached-class-constants.test.mjs` | 0.11s | 38 pass |

Final same-shape Oxlint measurements after the repair pass:

| Run | Command | Wall time | Result |
| --- | --- | ---: | --- |
| Cold | `bun run lint` | ~2.45s | pass |
| Warm | `bun run lint` | ~1.80s | pass |

The cold run remains above the aspirational two-second target because exact type-aware correctness is enabled. The warm run meets the target, and both are well below the former 8.32s cold / 6.84s warm ESLint baseline. Correctness takes priority over the target, but any regression beyond the old baseline requires an explicit reason.

## Package and configuration decisions

- Pin `oxlint` at `1.83.0` and `oxlint-tsgolint` at `7.0.2002`.
- The verified `@shadcn/lint` bridge pulled ESLint back through `@typescript-eslint/parser`'s mandatory peer under Bun. The approved fallback replaces only Home's used `no-restyle` contract with `home/no-restyle`; `@shadcn/lint` and the entire ESLint peer chain are removed.
- Use `apps/web/.oxlintrc.jsonc`. Do not use the experimental TypeScript configuration loader.
- Invoke Oxlint from `apps/web`, deny warnings, and report unused suppression directives. `bun run lint` has no ESLint fallback after parity is established.
- Keep root ignores explicit: `node_modules/**`, `.next/**`, `out/**`, `build/**`, `storybook-static/**`, `.storybook/static/mockServiceWorker.js`, and `next-env.d.ts`.
- Translate every ESLint override `ignores` entry to Oxlint `excludeFiles`; the official migration tool does not do this safely.
- Use native Oxlint rules first, type-aware Oxlint rules second, and small Home-owned direct visitors for the remaining contracts, including the bounded `home/no-restyle` fallback.
- Do not ship a permanent dual-linter path. The official migration output and a temporary dual run are evidence only.

## Exhaustive current rule ownership

The effective ESLint configuration exposes 96 active rule IDs. Every ID below must be either enabled with equivalent options, replaced by a named Home rule with fixtures, or recorded as an intentional semantic replacement before ESLint is deleted.

### Next.js — 22 rules

`google-font-display`, `google-font-preconnect`, `inline-script-id`, `next-script-for-ga`, `no-assign-module-variable`, `no-async-client-component`, `no-before-interactive-script-outside-document`, `no-css-tags`, `no-document-import-in-page`, `no-duplicate-head`, `no-head-element`, `no-head-import-in-document`, `no-html-link-for-pages`, `no-img-element`, `no-location-assign-relative-destination`, `no-page-custom-font`, `no-script-component-in-head`, `no-styled-jsx-in-document`, `no-sync-scripts`, `no-title-in-document-head`, `no-typos`, and `no-unwanted-polyfillio`.

Oxlint native ownership is preferred. `no-location-assign-relative-destination` is not available in the migration output and will be preserved as a Home visitor. Existing `no-img-element` exceptions remain specific, reasoned suppressions. Native diagnostics that differ from ESLint are classified rather than auto-fixed.

### TypeScript/core — 24 rules

`ban-ts-comment`, `no-array-constructor`, `no-duplicate-enum-values`, `no-empty-object-type`, `no-explicit-any`, `no-extra-non-null-assertion`, `no-misused-new`, `no-namespace`, `no-non-null-asserted-optional-chain`, `no-require-imports`, `no-this-alias`, `no-unnecessary-type-constraint`, `no-unsafe-declaration-merging`, `no-unsafe-function-type`, `no-unused-expressions`, `no-unused-vars`, `no-wrapper-object-types`, `prefer-as-const`, `prefer-namespace-keyword`, `triple-slash-reference`, `no-var`, `prefer-const`, `prefer-rest-params`, and `prefer-spread`.

The existing warning rules remain build-failing through deny-warnings. The type-aware pilot additionally evaluates `no-floating-promises`, `no-misused-promises`, `switch-exhaustiveness-check`, unsafe argument/assignment/call/member-access/return, and unnecessary assertions. Each is enabled only after positive and negative fixtures pass and real-tree diagnostics are classified. Production and test overrides may differ only to account for verified Bun test typing, not to hide source defects.

Pilot outcome: `no-floating-promises` is enabled tree-wide; twelve intentional synchronous React test `act()` calls now use explicit `void`. `no-misused-promises` found six existing callback-shape diagnostics and `switch-exhaustiveness-check` found seven existing partial switches. The broad unsafe family and unnecessary-assertion pilot produced thousands of diagnostics dominated by external/Bun typing boundaries (including 10,346 unsafe calls and 4,962 unsafe member accesses), so those rules are not enabled tree-wide. Phase 1 nevertheless enables `no-unsafe-member-access` for production `server/cdp/**` modules, excluding tests whose Bun matcher types create unrelated noise. Its three real-tree findings in `server/cdp/session.ts` were repaired by treating SDK array entries as `unknown` until their fields are parsed. Failing SDK-`any`, legal typed, and boundary-parsing fixtures keep this override non-vacuous without banning `unknown` or broad type assertions. The other unsafe rules remain classified rather than silently suppressed, and the targeted override does not weaken the migrated 96-rule baseline.

### React and React Hooks — 33 rules

React: `display-name`, `jsx-key`, `jsx-no-comment-textnodes`, `jsx-no-duplicate-props`, `jsx-no-undef`, `jsx-uses-react`, `jsx-uses-vars`, `no-children-prop`, `no-danger-with-children`, `no-deprecated`, `no-direct-mutation-state`, `no-find-dom-node`, `no-is-mounted`, `no-render-return-value`, `no-string-refs`, `no-unescaped-entities`, and `require-render-return`.

React Hooks: `rules-of-hooks`, `exhaustive-deps`, `config`, `gating`, `error-boundaries`, `globals`, `immutability`, `incompatible-library`, `preserve-manual-memoization`, `purity`, `refs`, `set-state-in-effect`, `set-state-in-render`, `static-components`, `unsupported-syntax`, and `use-memo`.

Rules obsolete under the automatic JSX runtime (`jsx-uses-react`, `jsx-uses-vars`) are intentionally removed after native `jsx-no-undef`/unused-variable controls prove equivalent usage detection. `require-render-return` uses the individually enabled nursery implementation. `react/no-deprecated` is intentionally removed: Home has no class-component lifecycle or removed ReactDOM/CreateClass/PropTypes usage, React 19 types reject those removed APIs, and Oxlint has no equivalent; revisit if such a compatibility seam appears. `react-hooks/config` and `react-hooks/gating` are intentionally removed because they only validate React Compiler plugin configuration and Home does not enable React Compiler; re-evaluate if `reactCompiler` is enabled. Existing `incompatible-library` suppression remains specific and reasoned.

### Import and accessibility — 7 rules

`import/no-anonymous-default-export`; `jsx-a11y/alt-text` with `{elements:["img"],img:["Image"]}`; `aria-props`; `aria-proptypes`; `aria-unsupported-elements`; `role-has-required-aria-props`; and `role-supports-aria-props`.

Equivalent native Oxlint rules retain their current options and build-failing severity.

### Home and third-party contracts — 10 rule IDs

`import/no-restricted-paths`, `no-restricted-imports`, `no-restricted-syntax`, `production-isolation/no-storybook-imports`, `server-only/require-server-only`, `shadcn/no-restyle`, `tailwind-policy/no-detached-class-constants`, `test-policy/no-source-reads`, `test-policy/no-real-waits`, and `test-policy/no-presentation-class-reads`.

The three generic ESLint IDs are replaced by stable, specific Home rule IDs rather than one opaque catch-all. `shadcn/no-restyle` is replaced by bounded `home/no-restyle` fixtures proving appearance rejection, layout acceptance, `components/ui` ownership, and test/story exclusions. The detached-class implementation is ported without simplification and expanded to a 118-case real-Oxlint corpus. In addition to local static strings, `home/no-detached-class-constants` rejects reached lookups into immutable local object/array class maps, including bounded aliases and transparent TypeScript wrappers. Known keys select one value; unknown keys require every effective last-write-wins value to be a non-empty static string. Imports, parameters, spreads, holes, dynamic keys or values, calls, mutable/reassigned/member-mutated bindings (including destructuring and loop write targets), predicate/data roles, non-final sequence operands, and lookup-result aliases remain clean.

## Home-owned rule contracts and required fixture matrix

| Contract | Scope | Passing/exception controls | Required violating coverage |
| --- | --- | --- | --- |
| Production workshop isolation | production app/client/components/config/lib/server/shared/types and root entrypoints; stories excluded | story and `.storybook` files | static import, export named/all, dynamic literal/template, and `require()` for Storybook/MSW paths |
| Layer boundaries | client/components exclude server; server excludes app/client/components; shared excludes app/client/server/components plus React/Next/Node | allowed same-layer and platform imports | aliases and relative paths for static import/export, literal/template dynamic import, and literal/template `require()`; target existence is not required |
| Server CDP unsafe members | production `server/cdp/**`; tests excluded | typed SDK results and parsed `unknown` boundaries | SDK-derived `any` member access |
| Browser SDK fence | wallet SDKs excluded from app/shared/general client; allowed in `client/account` | exact account scope | package root and subpaths in every prohibited layer |
| Base UI ownership | `@base-ui/react` only under `components/ui` | owned wrapper | package root and subpaths from app/client/components/shared/server |
| Server marker | non-test, non-declaration files under server | test and `.d.ts`; first import is bare `server-only` | missing marker and marker after another import |
| Shared formatting | app/client/components/shared outside approved geometry/shared-formatting/test paths | both geometry files, shared/formatting, tests | `Intl.NumberFormat`, `Intl.DateTimeFormat`, `toLocaleString`, `toLocaleDateString`, `toLocaleTimeString`, `toFixed` |
| Literal utility styles | app/client/components production | stock Tailwind scale and `var(--*)` arbitrary values | hex, rgba, raw palette, arbitrary px in className literal/expression/template and `cn`/`cva` literal/template |
| Raw elements | app/client/components production outside UI/tests; current button allowlist only | owned UI wrappers, tests, `client/landing/supported-globe.tsx`; field allowlist remains empty | `button`, `input`, and `select` across app/client/components |
| Detached classes | app/client/components production outside UI/stories/tests | imports, parameters, mutable/reassigned/member-mutated bindings (including destructuring and loop targets), calls and frozen wrappers, spreads, holes, dynamic shapes, predicate/data roles, non-final sequence operands, and lookup-result aliases | 118-case identifier/aggregate alias, scope, order, TypeScript-wrapper, static, and dynamic corpus |
| Test source reads | tests/helpers except migration subtree; two exact source-read exceptions | migration helper/subtree and Apple Pay asset test; other test rules remain active | fs imports/exports/dynamic/require/templates and `Bun.file` |
| Deterministic test timing | tests/helpers except migration subtree | 50ms timer and 2000ms wait boundaries | `setTimeout`, `setInterval`, `Bun.sleep`, and Testing Library waits above limits |
| Behavioral assertions | tests/helpers except migration subtree | class writes/mutations | className/classList/getAttribute("class") reads |
| Next relative location assignment | Next production scope | absolute and safe assignments | relative `location.assign`/equivalent cases matching the former rule |

Relative import enforcement resolves paths lexically against the importing file and classifies the first app/client/components/server/shared segment. It does not depend on ESLint's resolver or on the imported target existing.

## Curated deterministic guardrails

Home-owned rules use narrow, separately suppressible IDs and explicit positive/negative corpora:

- chained type assertions in production;
- `Reflect.get` and `Reflect.apply`;
- vague `object` parameters;
- aliases resolving directly to `unknown`;
- reducer accumulator copying and accumulating spread;
- immutable local known values widened to a broad type and later asserted narrower in the same function;
- exact Bun `mock.module` file/module pairs.

The Bun mock policy applies to test files and test infrastructure (including support/preload files under `tests/**`) and allows only:

- `tests/server-only-preload.ts` → `server-only`;
- `app/api/consolidated-native-base-session.test.ts` → `@/server/cdp/provider`;
- `client/home/home-experience.test.tsx` → `next/navigation`;
- `client/account/composite-account-provider.test.tsx` → `@coinbase/cdp-hooks`, `./native-base-bridge`, `@base-org/account`;
- `client/funding/funding-actions.test.tsx` → `next/navigation`.

Calls must resolve by scope to `mock` imported from `bun:test`, either directly, through a named or namespace import, or through an immutable local alias; computed literal `module` members are included. The first argument must be static, and the normalized `apps/web`-relative path must exactly match the reviewed policy map. A new path/specifier pair is a policy-map change. The rule does not infer Jest/Vitest cleanup semantics and does not require `mock.restore()` for the reviewed file-level mocks.

### Anti-slop source and disposition ledger

The review source is `dmmulroy/anti-slop` commit `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b` (MIT; retained in `apps/web/oxlint/THIRD_PARTY_NOTICES.md`). Counts are Oxlint 1.83.0 diagnostics over 648 files at the measured Home baseline; zero-hit rules are regression guards, not proof that a rule is unnecessary.

| Upstream generic rule | Measured hits | Home disposition |
| --- | ---: | --- |
| `no-array-filter-map` | 5 | Reject: bounded readable pipelines and runtime-support ambiguity do not justify policy. |
| `no-reduce-accumulator-copy` | 0 | **Accept** as `home/no-reduce-accumulator-copy`, with reducer/reduceRight, computed literal, alias, shadowing, nested-return, and array-evidence fixtures. |
| `no-chained-type-assertions` | 105 | Retain the narrower Home rule and add parenthesized/angle/all-const-chain coverage. |
| `no-conditional-empty-object-spread` | 157 | Reject: omission semantics are intentional, especially for provider payloads. |
| `no-known-value-widening` | 99 raw; 10 in the artifact's initial narrow probe | Reject, including the later known-object/open-dictionary proposal: the four current in-scope candidates are intentional runtime-keyed maps, and replacing their annotations with `satisfies` preserves literal keys so runtime indexing fails typecheck. |
| `no-module-mocking` | 0 upstream; 7 Home Bun calls | Retain Home's exact `bun:test` `mock.module` file/specifier map; do not import Jest/Vitest policy. |
| `no-object-parameters` | 0 | Retain as `home/no-vague-object-parameters`. |
| `no-reflect-apply` | 0 | Retain under `home/no-reflect-indirection`. |
| `no-reflect-get` | 0 | Retain under `home/no-reflect-indirection`. |
| `no-runtime-typeof` | 684 | Reject: boundary parsers require runtime primitive checks. |
| `no-shape-in-symbol-names` | 6 | Reject: descriptive validator names are not a correctness defect. |
| `no-unknown-parameters` | 316 | Reject: provider, request, wallet, DOM, and error boundaries legitimately receive `unknown`. |
| `no-unknown-returns` | 96 | Reject: raw boundary adapters may intentionally return `unknown` to an owner parser. |
| `no-unknown-type-aliases` | 0 | Retain Home's direct-alias form as `home/no-unknown-aliases`. |
| `no-unsafe-dictionary-type` | 199 | Reject: JSON/provider dictionaries are legitimate boundary contracts. |
| `no-widen-then-assert` | 0 | **Accept** as `home/no-widen-then-assert`, limited to immutable same-function local evidence; genuine boundaries, predicate validation, mutation, captures, direct assertions, and same-width assertions are clean fixtures. |
| `require-readable-spacing` | 8,580 | Reject: formatter-scale churn is outside this migration. |
| `require-safety-comment-for-type-assertion` | 896 | Reject: boilerplate comments are not executable evidence. |

The Effect group is also exhaustive: `no-service-constructor-imports`, `no-manual-tag-comparison`, `no-manual-effect-error-tag`, `no-manual-tagged-construction`, and `prefer-effect-match` are all not applicable because Home has no Effect dependency or Effect-owned architecture. Native `oxc/no-accumulating-spread` measured zero hits and remains deferred: enabling it beside Home's reducer rule would duplicate reducer ownership and silently add loop policy. Reconsider it only as an explicit replacement with fixture parity and a separate decision on loops.

The two accepted rules are production-only zero-hit guards owned in `oxlint/rules/anti-slop.mjs`, registered in `home-plugin.mjs`, enabled in the existing production override, isolated in `oxlint/tests/anti-slop.test.mjs`, and represented by failing and clean delivery-mirror canaries. All other generic rules, the Effect group, and native accumulating-spread are rejected or deferred as recorded above.

## Checked-in implementation layout

```text
apps/web/.oxlintrc.jsonc
apps/web/oxlint/home-plugin.mjs
apps/web/oxlint/rules/imports.mjs
apps/web/oxlint/rules/server-only.mjs
apps/web/oxlint/rules/styles.mjs
apps/web/oxlint/rules/formatting.mjs
apps/web/oxlint/rules/raw-elements.mjs
apps/web/oxlint/rules/tests.mjs
apps/web/oxlint/rules/anti-slop.mjs
apps/web/oxlint/rules/no-detached-class-constants.mjs
apps/web/oxlint/policy/mock-modules.mjs
apps/web/oxlint/THIRD_PARTY_NOTICES.md
apps/web/oxlint/tests/anti-slop.test.mjs
apps/web/oxlint/tests/*.test.mjs
scripts/delivery/tests/oxlint-contracts.test.mjs
```

Rule-isolation tests may invoke Oxlint against temporary on-disk fixtures. The delivery canary never writes fixtures into the working source tree. It builds a mirror under `os.tmpdir()`, copies the checked-in `.oxlintrc.jsonc` and `oxlint/**` byte-for-byte, symlinks `node_modules`, `components.json`, `tsconfig.json`, the CSS entrypoint referenced by `components.json`, and the required owned UI wrapper, then writes representative fixtures under mirrored app/client/components/server/shared/tests paths. It runs the pinned binary from the mirror root with JSON output and nested config disabled. The test asserts copied config/plugin bytes equal the checked-in sources, checks exact rule IDs and diagnostic counts, and includes a fixture-only sentinel proving each representative path was covered. It proves `node_modules` and generated-output ignores through both zero diagnostics and absence from Oxlint's debug file list. The mirror copies Home's replacement `home/no-restyle` implementation and no longer loads `@shadcn/lint`; this avoids concurrent source-tree mutation or crash debris. A passing clean source tree is never accepted as parity evidence by itself.

## Delivery and deletion gates

ESLint is removed only after all of the following are true:

1. Every inventory item above has native, bridged, Home-owned, intentionally replaced, or intentionally removed ownership with fixture evidence.
2. The full Home visitor corpora pass under the exact checked-in Oxlint versions and final config.
3. `home/no-restyle` canaries prove appearance rejection, layout acceptance, `components/ui` ownership, and exact test/story exclusions without a clean-tree shortcut.
4. Real-tree type-aware diagnostics are classified; no rule is disabled merely to suppress copied-tree or Bun-global noise.
5. `app/coverage/page.tsx` and `client/account/cdp-money-action-execution.test.ts` native semantic differences are classified as defects or rule mismatch.
6. Static, alias, relative, dynamic, template, and require boundary matrices pass.
7. Existing allowlists are identical or smaller.
8. The three current source suppressions are converted to exact, reasoned Oxlint directives or removed because equivalent ownership makes them unnecessary.
9. `bun run gates`, Oxlint-only `bun run lint`, and `bun check` pass after `bun install --frozen-lockfile` without changing `bun.lock`.
10. Cold and warm lint timings are recorded using the baseline command shape.
11. `eslint`, `eslint-config-next`, TypeScript ESLint dependencies, import resolver/plugin packages, `@shadcn/lint`, migration-only packages, `apps/web/eslint.config.mjs`, and obsolete ESLint tests are absent from the manifest and lockfile.
12. `AGENTS.md`, `docs/architecture.md`, `docs/design-system.md`, `docs/delivery-gates.md`, `README.md`, `CONTRIBUTING.md`, and `apps/web/README.md` describe the final Oxlint-owned contract where relevant.
13. Fresh independent review verifies parity, non-vacuous canaries, dependency cleanup, unchanged/shrunk allowlists, and the exact current head.

Browser preview evidence is not applicable because this migration has no user-visible UI change.
