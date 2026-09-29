# Revision 5

Revision 5 (2026-09-23, run 12) extends the historical audit to Home states after #804 merged. `TotalBalanceCard` and `YourMoneyCard` use `Card`; the Activity feed uses `ActivityHeading` and `ActivityRows`. Loading, empty, Activity error and status popover states use `Skeleton`, `ShimmerRow`, `Empty`, `Button` and `Popover` (code gained `components/ui/popover.tsx` in #804). `Skeleton` takes code's `bg-foreground/10` tone. Review current Home states in Storybook against the shipped component.
