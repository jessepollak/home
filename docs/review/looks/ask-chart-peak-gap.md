# Look: ask/chart-peak-gap

Fixture session, /invest/nvdac, a series that climbs to a flat peak and then drops, data ending early. 1W (same year) and 1Y (Sep 27, 2025 – Sep 27, 2026), at 390 and 1280.

- Before: the flat peak's top edge sits 22px under the "No data since" label at 390 and 1280. The 1Y gap label reads "No data since Sep 27" under a header that reads "Sep 27, 2025 – Sep 27, 2026".
- After: the plot's top inset is 28px instead of 20px. Any point Liveline clamps to the plot edge now stays 10px below the label instead of touching it, and the flat peak sits 7px lower (topmost line pixel 47px, label bottom 18px, measured across a 1W→1Y switch). The 1Y gap label reads "No data since Sep 27, 2026", and so does the chart's accessible name. 1W is unchanged ("No data since Nov 25, 11:31 PM"). Across a year, the label shows the date with the year and no time, so it is never longer than the same-year 1W label.
- At 200% text on 390, "No data since Sep 27, 2026" fits on one line, 73px from the left edge.
- Hover scrubbing: the cursor runs from the new top inset to the bottom inset, and the dot stays on the line ($186.80 on the peak).
- Labels stay on one line and right-aligned at both widths. The range toggle and desktop card layout are unchanged.
