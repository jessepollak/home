import type { StorybookConfig } from "@storybook/nextjs-vite";
import { reviewEnv } from "./review-env";
import { readReviewBuild } from "../stories/review/explorations/board/review-build";

const buildEnv = reviewEnv();

const storybookProject = { id: "prj_g2Z1QnL2lhLddSxhQxo8yTCWFTVU", owner: "team_ymxui13vYrTC0G95tx4BCCqE" };

function vercelComments(): string {
  if (process.env.VERCEL_ENV !== "preview") return "";
  const attribute = (value: string) => JSON.stringify(value).replace(/</g, "\\u003c");
  const deployment = attribute(process.env.VERCEL_DEPLOYMENT_ID ?? "");
  const branch = attribute(process.env.VERCEL_GIT_COMMIT_REF ?? "");
  const mount = `if(window.__reviewFeedbackMounted||document.querySelector('script[src*="vercel.live"],vercel-live-feedback'))return;` +
    `window.__reviewFeedbackMounted=true;const s=document.createElement("script");s.src="https://vercel.live/_next-live/feedback/feedback.js";` +
    `s.async=true;s.dataset.explicitOptIn="true";s.dataset.deploymentId=${deployment};s.dataset.projectId=${attribute(storybookProject.id)};` +
    `s.dataset.ownerId=${attribute(storybookProject.owner)};s.dataset.branch=${branch};document.head.appendChild(s);`;
  return `<script>if(window.top===window){const mount=()=>{${mount}};` +
    `if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount,{once:true});else mount();}</script>`;
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
    JSON.stringify(readReviewBuild(await buildEnv)).replace(/</g, "\\u003c")};</script>${vercelComments()}`,
  previewHead: (head) => `${head}${vercelComments()}`,
};

export default config;
