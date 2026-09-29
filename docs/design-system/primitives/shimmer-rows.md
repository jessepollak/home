# Shimmer rows

- `ShimmerRows` in `apps/web/client/home/panel-shared.tsx` keeps only the shapes production draws: `rows` (a mark, two label lines and a value) and `hero` (the hero placeholder).
- Review `ShimmerRows` in Storybook. Every production loading consumer renders a mark and two lines once loaded, so there is no media-less or context-less shape to adopt.
