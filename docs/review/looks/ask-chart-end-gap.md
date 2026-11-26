# Look: ask/chart-end-gap (follow-up from #2348, area debt #2151)

Before and after captures from a fixture session (pinned `bun run ab`, 1280×900 and 390×844), 1Y range. Each history body was routed relative to the real clock.

- Bitcoin, Codex daily bars ending 6 days early: before, no cue and the line simply stops short. After, the existing "No data since Nov 20" label and end dot appear, in the same place and style as a past-4% gap. The change line and Stats switch to the existing "Nov 26 – Nov 20" span wording for an early end. Readable at both widths; the label sits clear of the line and tabs.
- XRP, live series (last daily bar about 10 hours old): no label before or after.
- Microsoft, a stock series whose last sample is about 2.6 days old (a weekend close): no label before or after. Stock thresholds are unchanged, because the 32-sample interval keeps the old 4% bound.

No layout shift or new copy. The span reads "Nov 26 – Nov 20" without years. That is the existing `chart-date` format, also used for gaps past 4%, and this change leaves it alone. "Price snapshot is stale" and the dash price come from the fixture's fixed-clock quotes, not from this change. Pictures: `/tmp/ceg/shots/` (attached to the PR).
