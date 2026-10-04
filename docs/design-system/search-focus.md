# Shell Search focus lifecycle

Search's visual exit does not own keyboard dismissal or opener restoration. The retained exit surface is immediately inert and hidden from accessibility; its focused descendant is blurred and its viewport subscription released. The shared viewport source recomputes when a subscriber leaves, including when browser inert handling moves focus without emitting a focus event.

| Transition | Focus behavior | Regression evidence |
|---|---|---|
| Closed → activating Search | Focus the input synchronously in the activating gesture | `asset-search.test.tsx`: opening focuses in the click; `invest-search.pw.ts`: immediate reopen |
| Open → Close, non-composing Escape or Back | Blur any focused descendant of the exiting surface; restore the opener once visible and non-inert, without waiting for exit animation | `home-experience.test.tsx`: pending keyboard-hidden restoration; `invest-search.pw.ts`: simulated keyboard Escape/Close/Back |
| Pending restoration → user focus takeover, route/owner change, overlay replacement or reopen | Cancel the old restoration; do not steal the new focus | `home-experience.test.tsx`: pending restoration cases |
| Closing → immediate reopen | Retain synchronous input focus and reset entry-local query/composition/scroll state | `asset-search.test.tsx`: retained reopen cases; `invest-search.pw.ts`: normal/reduced motion |
| Viewport subscriber release with silent focus loss | Recompute geometry once through the shared RAF scheduler; retain other subscribers and clean up the last subscriber | `visual-viewport.test.ts`: shared subscriptions and silent focused-input removal |

Composition Escape remains open. Reduced motion does not change focus ownership. Route and owner changes discard the old presence boundary; results remain noninteractive throughout exit. Real device keyboard behavior still requires device verification; fixture Chromium uses simulated viewport geometry.
