# 21. AssetDetailHeader extraction

| # | Follow-up | Disposition | Delivery | State (2026-09-26) |
| --- | --- | --- | --- | --- |
| 21 | AssetDetailHeader extraction | Deferred (owner: Jesse) | [#939](https://github.com/jessepollak/home/issues/939), PR [#1105](https://github.com/jessepollak/home/pull/1105) | Not extracted. In the selected revision the price and change follow the scrub (design-only `AssetPriceHeader`, `424:4543`), and the Back, mark and name row is omitted when the page is hosted in Home Investments, so the header stays inline in `AssetDetailScreen`, which Code Connect maps as the whole selected section `422:4404`. `AssetDetailHeader` `166:1917` stays not mapped. Extract only if a second screen needs the header |
