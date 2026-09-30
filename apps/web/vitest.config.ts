import path from "node:path";
import { fileURLToPath } from "node:url";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const explorationStories = process.env.HOME_STORY_TEST_EXPLORATIONS === "1";

// Story tests run selected `*.stories.*` files through Storybook's Vite config in
// headless Chromium, executing `play` functions and the a11y addon's checks.
// More info: https://storybook.js.org/docs/writing-tests/integrations/vitest-addon
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        plugins: [storybookTest({
          configDir: path.join(dirname, ".storybook"),
          tags: explorationStories ? { include: ["exploration"] } : { exclude: ["exploration"] },
        })],
        test: {
          name: "storybook",
          setupFiles: [path.join(dirname, ".storybook/vitest.setup.ts")],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
