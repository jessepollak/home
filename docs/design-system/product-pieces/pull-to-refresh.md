# Pull to refresh

- `PullToRefreshIndicator` and `PullToRefreshAction` (`components/ui/pull-to-refresh.tsx`) own Home's gesture feedback and focus-revealed keyboard action; `usePullToRefresh` binds the gesture to the Home scroll owner and moves only transform, scale, rotate and opacity during a drag.
- The Home scroll owner supplies the live announcement and failure recovery. The gesture and action are adopted only on Home, and the gesture is disabled while a sheet or detail view is open.
