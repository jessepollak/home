# 5. Safari-tab safe area

| # | Follow-up | Disposition | Delivery | State (2026-09-26) |
| --- | --- | --- | --- | --- |
| 5 | Enable `viewport-fit=cover` and handle top/side safe areas in Safari tabs | Deferred (owner: Jesse) | Future issue after [#1036](https://github.com/jessepollak/home/issues/1036) | Today `--shell-safe-area-bottom` reads `env(safe-area-inset-bottom)` only in standalone mode; the journey simulates 34px. Safari-tab support requires a separate header/side inset decision and device verification. |
