import type { StorybookConfig } from "@storybook/nextjs-vite";

const config: StorybookConfig = {
  stories: [
    "../{client,components}/**/*.stories.@(js|jsx|mjs|ts|tsx)",
    "../stories/**/*.stories.@(js|jsx|mjs|ts|tsx)",
  ],
  addons: [
    "@storybook/addon-a11y",
    "@storybook/addon-vitest",
    "@storybook/addon-mcp",
  ],
  framework: {
    name: "@storybook/nextjs-vite",
    options: {},
  },
  staticDirs: ["../public", "./static"],
  features: {
    developmentModeForBuild: false,
    // Serves the components/docs manifests that the MCP docs toolsets read.
    // `componentsManifest` is Storybook 10.6's feature key; keep it explicit
    // instead of relying on @storybook/addon-mcp's preset to force it.
    componentsManifest: true,
    // Versioned alias required by issue #660; on its own it would only be
    // honored through core's legacy fallback.
    experimentalComponentsManifest: true,
  },
};

export default config;
