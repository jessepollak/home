import type { StorybookConfig } from "@storybook/nextjs-vite";
import { reviewEnv } from "./review-env";
import { readReviewBuild } from "../stories/review/explorations/board/review-build";

const buildEnv = reviewEnv();

function vercelComments(topOnly: boolean): string {
  if (process.env.VERCEL_ENV !== "preview") return "";
  const deployment = JSON.stringify(process.env.VERCEL_DEPLOYMENT_ID ?? "").replace(/</g, "\\u003c");
  const mount = `const s=document.createElement("script");s.src="https://vercel.live/_next-live/feedback/feedback.js";` +
    `s.async=true;s.dataset.explicitOptIn="true";s.dataset.deploymentId=${deployment};document.head.appendChild(s);`;
  return `<script>${topOnly ? `if(window.top===window){${mount}}` : mount}</script>`;
}

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
  env: async (env) => ({ ...env, ...await buildEnv }),
  managerHead: async (head) => `${head}<script>window.__REVIEW_BUILD__ = ${
    JSON.stringify(readReviewBuild(await buildEnv)).replace(/</g, "\\u003c")};</script>${vercelComments(false)}`,
  previewHead: (head) => `${head}${vercelComments(true)}`,
};

export default config;
