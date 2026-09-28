# Shimmer rows

- `ShimmerRows` in `apps/web/client/home/panel-shared.tsx` keeps only the shapes production draws: `rows` (a mark, two label lines and a value) and `hero` (the hero placeholder).
- Figma `ShimmerRow`, node `274:6015`. Its proposed `Show media` and `Show context` booleans stay design-only: every production loading consumer renders a mark and two lines once loaded, so there is no media-less or context-less shape to adopt.
