import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const sharedLayerMessage =
  "shared modules must remain runtime-agnostic and independent of web application layers";
const clientLayerMessage = "client modules must not import the server layer";
const serverLayerMessage = "server modules must not import web client or app layers";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: ["shared/**/*.{js,jsx,ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "react", message: sharedLayerMessage },
            { name: "react-dom", message: sharedLayerMessage },
            { name: "next", message: sharedLayerMessage },
            { name: "@/app", message: sharedLayerMessage },
            { name: "@/client", message: sharedLayerMessage },
            { name: "@/server", message: sharedLayerMessage },
            { name: "@/components", message: sharedLayerMessage },
          ],
          patterns: [
            {
              group: [
                "react/*",
                "react-dom/*",
                "next/*",
                "node:*",
                "@/app/*",
                "@/client/*",
                "@/server/*",
                "@/components/*",
              ],
              message: sharedLayerMessage,
            },
          ],
        },
      ],
    },
  },
  {
    files: ["client/**/*.{js,jsx,ts,tsx}", "components/**/*.{js,jsx,ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "@/server", message: clientLayerMessage }],
          patterns: [
            {
              group: ["@/server/*"],
              message: clientLayerMessage,
            },
          ],
        },
      ],
    },
  },
  {
    files: ["server/**/*.{js,jsx,ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@/app", message: serverLayerMessage },
            { name: "@/client", message: serverLayerMessage },
            { name: "@/components", message: serverLayerMessage },
          ],
          patterns: [
            {
              group: ["@/app/*", "@/client/*", "@/components/*"],
              message: serverLayerMessage,
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
