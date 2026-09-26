import type { StorybookConfig } from "@storybook/nextjs-vite";
import { execFileSync } from "node:child_process";

// `experimentalComponentsManifest` is not in Storybook's public
// `StorybookFeatures` type, so the features live in a named object rather than
// a fresh literal that TypeScript's excess-property check would reject.
const features: NonNullable<StorybookConfig["features"]> & { experimentalComponentsManifest: boolean } = {
  developmentModeForBuild: false,
  // Serves the components/docs manifests that the MCP docs toolsets read.
  // `componentsManifest` is Storybook 10.6's feature key; keep it explicit
  // instead of relying on @storybook/addon-mcp's preset to force it.
  componentsManifest: true,
  // Versioned alias required by issue #660; on its own it would only be
  // honored through core's legacy fallback.
  experimentalComponentsManifest: true,
};

const config: StorybookConfig = {
  stories: [
    "../{client,components}/**/*.stories.@(js|jsx|mjs|ts|tsx)",
    "../stories/**/*.stories.@(js|jsx|mjs|ts|tsx)",
  ],
  addons: [
    "@storybook/addon-a11y",
    // Figma frame beside each story (parameters.design); see figma-components.json.
    "@storybook/addon-designs",
    "@storybook/addon-vitest",
    "@storybook/addon-mcp",
  ],
  framework: {
    name: "@storybook/nextjs-vite",
    options: {},
  },
  staticDirs: ["../public", "./static"],
  features,
  env: (env) => {
    let revision = process.env.VERCEL_GIT_COMMIT_SHA;
    if (!revision) {
      try { revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); }
      catch { revision = "local"; }
    }
    return {
      ...env,
      STORYBOOK_REVIEW_REVISION: revision,
      STORYBOOK_REVIEW_DEPLOYMENT: process.env.VERCEL_URL ?? "",
      STORYBOOK_REVIEW_BRANCH: process.env.VERCEL_GIT_COMMIT_REF ?? "",
    };
  },
};

export default config;
