# Revision 7

Revision 7 ([#2073](https://github.com/jessepollak/home/issues/2073), PR [#2081](https://github.com/jessepollak/home/pull/2081)) named roles for elevation, interaction states, shape and type in the Library foundations. Each proposal is rendered beside the scanned current usage on the Elevation, States, Type and Radius & spacing pages (`review-library--foundations`). Motion stays with [#1696](https://github.com/jessepollak/home/issues/1696).

## Jesse's selection

Jesse selected all four proposals as rendered, including the heading role that brings the Result and Feature intro headlines down to 16px.

- **Elevation.** Four levels: raised (card ring plus a faint shadow; ring only in Dark), floating (anchored popups; a stronger ring and shadow in Dark), overlay (dialog and drawer; ring only in Dark, since the scrim separates them), and toast (the strongest Dark lift, with the border replaced by the ring).
- **States.** One contract for hover/highlight (foreground tint 5% Light, 7% Dark), pressed (8%, 11%), focus-visible (unchanged neutral ring), disabled (50% opacity, no extra fill) and selected (the pressed tint with foreground text). Inputs gain a hover border. `Button press` stays.
- **Shape.** `--radius` stays 0.25rem. Controls use `rounded-lg`, row/card and popup use `rounded-xl`, sheets use `rounded-2xl`, and pill/avatar uses `rounded-full`; marks nested in a control use `rounded-sm`. `rounded-xs`, `rounded-md` and `rounded-4xl` retire.
- **Type.** Roles on the stock scale: amount (`text-4xl font-semibold leading-none tabular-nums`), heading (`text-base font-semibold`), body (`text-sm`), label (`text-sm font-medium`), metadata (`text-xs text-muted-foreground`), numeric (`tabular-nums` modifier) and mono (`font-mono text-sm`). Three weights carry the system.

## Exceptions

- Prompt Input's `rounded-3xl` stays unassigned and keeps its current radius (follow-up 24e).

Production adoption is [#2083](https://github.com/jessepollak/home/issues/2083); until it lands, code keeps its current treatments. Coverage is in [follow-up 24](../follow-ups/24-foundation-roles.md).
