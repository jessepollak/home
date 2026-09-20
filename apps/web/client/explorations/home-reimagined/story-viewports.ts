/**
 * Shared story setup for the Home reimagined exploration
 * ([issue #662](https://github.com/jessepollak/home/issues/662)).
 *
 * Storybook 10 dropped the `viewport.defaultViewport` parameter, so each exploration story
 * registers its own named viewports and selects one through the `viewport` global. The
 * representative mobile review composition stays 390×844 CSS pixels; desktop review is
 * 1280×800.
 */

export const homeReimaginedViewports = {
  mobile: {
    name: "Home mobile (390×844)",
    styles: { width: "390px", height: "844px" },
  },
  desktop: {
    name: "Home desktop (1280×800)",
    styles: { width: "1280px", height: "800px" },
  },
} as const;

export type HomeReimaginedViewport = keyof typeof homeReimaginedViewports;

/**
 * Story-level globals and parameters that pin the viewport regardless of the workshop's
 * preview defaults.
 */
export function reviewViewport(value: HomeReimaginedViewport = "mobile") {
  return {
    globals: { viewport: { value } },
    parameters: {
      layout: "fullscreen",
      viewport: { options: homeReimaginedViewports },
    },
  };
}
