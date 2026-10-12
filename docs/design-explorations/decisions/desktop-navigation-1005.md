# Desktop navigation — #1005

- **Surface:** desktop shell and Home overview.
- **Axis:** rail navigation, layout, scrolling and money dialogs.
- **Verbatim words:** not recorded.
- **Status:** selected.
- **Board frame link:** —.
- **PR link:** —.
- **Date:** not recorded.

## Notes

Accepted by Jesse on [#1005](https://github.com/jessepollak/home/issues/1005) and implemented in [#1044](https://github.com/jessepollak/home/issues/1044), refining the [#694](https://github.com/jessepollak/home/issues/694) proposal.

- **Navigation:** at ≥1024px, `PrimaryNavigation layout="rail"` replaces the floating tab capsule. The rail starts expanded at 240px, collapses to a 64px icon rail, and remembers the choice per device. Home · Invest sit above Account at the foot; Card joins when [#636](https://github.com/jessepollak/home/issues/636) is selected. The HomeMark owns a 44px hit area. Below 1024px, the mobile header and floating glass capsule remain; the 640–1023px top strip is gone.
- **Scroll and controls:** the rail and header stay pinned; the document is the only scroll region at every width, and Back/Forward restore its offset. The Home money column sticks while the document scrolls when the window is ≥640px tall and the column fits. Nav and header controls have 44px targets at every width; content controls keep their fine-pointer sizes.
- **Content:** the header has a max-width 1120px frame on every destination. Home uses a centred max-width 1120px grid: money about 3fr on the left, Activity about 2fr on the right. Other destinations use a 640px column aligned beneath the title.
- **Money dialogs:** a centred 480px dialog at ≥1024px, a bottom sheet below.
- **Review:** compare the desktop `home-overview--*` Storybook stories with the shipped Home route.
