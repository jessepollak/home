# Currency flag assets

Flag SVGs from [jdecked/twemoji](https://github.com/jdecked/twemoji) v15.1.0
(jsDelivr pin `gh/jdecked/twemoji@15.1.0/assets/svg/<codepoints>.svg`).

Twemoji graphics are Copyright 2019 Twitter, Inc and other contributors,
licensed under [CC-BY 4.0](./LICENSE.md). Attribution: "Twemoji" by Twitter,
Inc and other contributors, https://github.com/jdecked/twemoji. The files are
unmodified; Home renders them inset in a neutral circle (see
`apps/web/components/currency-mark.module.css`).

Vendored locally so cash chrome does not fetch flags at runtime. Only
presentation/cash currencies from `apps/web/config/regions.ts` are included.
Each file is named by its lowercase ISO 3166-1 code; `eu.svg` is upstream
`1f1ea-1f1fa.svg` (the European Union flag).

Do not add flag art from a different source without updating this file.
