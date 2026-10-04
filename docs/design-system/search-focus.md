# Shell Search focus lifecycle

Search's visual exit does not own keyboard dismissal or opener restoration. The retained exit surface is immediately inert and hidden from accessibility; its focused descendant is blurred and its viewport subscription released. The shared viewport source recomputes when a subscriber leaves, including when browser inert handling moves focus without emitting a focus event.

| Transition | Focus behavior | Regression evidence |
|---|---|---|
| Closed → activating Search | Focus the input synchronously in the activating gesture | `invest-search.pw.ts`: search close mid-enter and immediate reopen |
| Open → Close, non-composing Escape or Back | Blur any focused descendant of the exiting surface; restore the opener once visible and non-inert, without waiting for exit animation | `invest-search.pw.ts`: keyboard-hidden focus after Escape/Close/Back |
| Pending restoration → user focus takeover, route/owner change, overlay replacement or reopen | Cancel the old restoration; do not steal the new focus | `invest-search.pw.ts`: immediate reopen keeps input focus; other takeovers: none |
| Closing → immediate reopen | Retain synchronous input focus and reset entry-local query/composition/scroll state | `invest-search.pw.ts`: normal/reduced motion |
| Viewport subscriber release with silent focus loss | Recompute geometry once through the shared RAF scheduler; retain other subscribers and clean up the last subscriber | `navigation-geometry.pw.ts`: shared keyboard geometry restores after a silent blur |

Search requires both an explicitly on Invest offering and a visible catalog shelf. The portfolio content gate and shell availability gate independently enforce the offering check; account and money overlays retain precedence. Exit-only and unavailable offerings do not remove owned Investments detail or exits. Availability revocation removes the old presence boundary without opener restoration; an owner change replaces it with surface focus, not input autofocus. The `AvailabilityRevoked` and `OwnerChanged` search journey stories exercise those runtime transitions.

The desktop rail stays mounted behind the modal, inside the same inert and accessibility-hidden boundary as production. Search traps Tab within its controls and blocks rail focus and pointer activation until Close, Escape or Back. The desktop modal cases in `invest-search.pw.ts` exercise all three exits, including opener focus return.

Composition Escape remains open. Reduced motion does not change focus ownership. Route and owner changes discard the old presence boundary; results remain noninteractive throughout exit. Real device keyboard behavior still requires device verification; fixture Chromium uses simulated viewport geometry.

Search activation owns a separate context and subtree. Its synchronous input mount updates only the search surface, navigation state, inert boundaries and refresh controls; shell page and routing values retain their identity when their inputs do not change. Search-result readiness still finalizes the durable origin in the shell through `commitClientUrl`.

## Search morph

Below 64rem the opener circle grows into the field over 300ms (`cubic-bezier(.4, 0, .2, 1)`), and closing reverses it. Every moving part animates only `transform` or `opacity`; nothing interpolates `clip-path`, `box-shadow`, width or color. Chromium traces confirm every morph animation is composited. WebKit treats both properties as accelerated, but backdrop blur inside the translated half-windows still needs device verification on iOS Safari.

- **Shell.** The field's glass is two halves. Each half is a rectangular window, half the field wide, holding a full-width glass pill. Both windows meet at the shape's midpoint and translate by half of the start edge's travel; the start-half pill translates with the start edge and the end-half pill counter-translates to stay put. The union is always a capsule from the moving start edge to the fixed end edge, with intact caps and rim, and neither the backdrop blur nor the rim is ever scaled.
- **Content.** Icon, input and clear button sit in a rounded clip that translates with the start edge inside the field's static rounded overflow. The intersection of the two capsules is the visible shape, so placeholder text never escapes it. The content moves only the few pixels needed to centre the icon in the circle.
- **Companions.** The field and its static shadow span translate by the gap plus one circle. The shadow and close action fade by opacity. The navigation's shadow lives on a pseudo-element that fades by opacity rather than transitioning `box-shadow`; the opener circle reappears through a 1ms opacity step after the close morph.
- **Controls.** The `floating-control` button variant transitions only its press scale, and the `shell-search` input variant has no transition, so focus, hover and focus-ring changes are instant.

All halves share one duration and easing, so CSS transition reversal keeps them aligned when a close interrupts an open. RTL mirrors the translations through `--search-morph-sign`. Reduced motion removes every transition. At 64rem and wider the halves sit at rest and the field uses its bordered desktop style.

## Keyboard lift

iOS WebKit reads the keyboard's end frame from its will-show and will-change-frame notifications and schedules one visible-content update, so `visualViewport` resizes once, near the start of the keyboard animation, with the final geometry. The search bar therefore transitions its `--shell-viewport-keyboard-height` transform over 250ms on a keyboard-like ease-out (`cubic-bezier(.38, .7, .125, 1)`) to travel with the keyboard instead of jumping before it. The independent `translate` applies `--shell-viewport-pan` instantly, so an `offsetTop` change does not trail the navigation group or restart the height transition. The transition retargets from its current position when the keyboard reverses, is instant under reduced motion, and is absent at 64rem and wider. Only the search bar animates: the navigation pill stays hidden while another field owns the keyboard and lands at rest without transform lag. The results clearance padding updates instantly. `invest-search.pw.ts` samples the height transition and checks immediate pan correction in both motion modes.

Viewport geometry is written directly to the navigation group/capsule, search bar, results scroller and toast viewport. The three length properties are registered with `inherits: false`, so a keyboard event does not propagate changed custom properties through the page tree. Each newly retained consumer schedules the shared geometry update; the root retains only the keyboard-state attribute. Drawer keyboard frames remain independently scoped to the drawer.

A subframe's `visualViewport` is its own frame box, so it never shrinks for the keyboard. Storybook's preview (`apps/web/.storybook/framed-keyboard.ts`) bridges this for same-origin frames, such as review-board story frames, only when the unzoomed top window's visual viewport bottom is occluded by more than 60px. It maps that bottom through each frame's position and scale into the frame's `visualViewport.height`; ordinary frame clipping leaves native geometry intact. Cross-origin chains are a no-op. Installation is idempotent, restores the native getter on HMR disposal or non-persisted pagehide, and retains forwarding through bfcache restores. Product code keeps reading its own viewport.

## Search-result history

Opening a result keeps the search entry's query, scroll position and selected result. The detail navigation carries an entry-specific temporary hash. The mounted detail signals readiness from a passive effect; the shell then finalizes the origin through the notifying `commitClientUrl` path, saving the search origin and query while synchronizing the router's canonical URL to the hashless detail URL. Shell pathname alone can be optimistic before the detail tree commits: a layout-effect write can be overwritten by Next, and even a shell passive effect can restore the wrong tree.

The pending origin remains available to the detail until a later readiness signal observes the matching durable token, origin and query on a hashless entry. Browser traversal and reload use the saved entry metadata; in-app Back returns to the previous search entry and restores the selected result's focus and results scroll. When the saved shell entry still belongs to the detail, the search surface initializes from the matching current browser entry rather than waiting for the popstate state update; this preserves cold-return restoration on the surface's first mount.

The existing `floating asset search` cases in `invest-search.pw.ts` run at 390px and 1280px in both the development regression project and `chromium-production-navigation`, including detail Forward/reload and return to search.
