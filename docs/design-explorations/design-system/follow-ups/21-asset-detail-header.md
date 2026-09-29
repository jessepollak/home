# 21. AssetDetailHeader extraction

| # | Follow-up | Disposition | Delivery | State (2026-09-26) |
| --- | --- | --- | --- | --- |
| 21 | AssetDetailHeader extraction | Deferred (owner: Jesse) | [#939](https://github.com/jessepollak/home/issues/939), PR [#1105](https://github.com/jessepollak/home/pull/1105) | Not extracted. In the selected revision the price and change follow the scrub, and the Back, mark and name row is omitted when the page is hosted in Home Investments, so the header stays inline in `AssetDetailScreen`. Review the `invest-asset-detail--*` stories against the shipped component. Extract only if a second screen needs the header |
