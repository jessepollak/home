import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const sharedLayerMessage =
  "shared modules must remain runtime-agnostic and independent of web application layers";
const clientLayerMessage = "client modules must not import the server layer";
const serverLayerMessage = "server modules must not import web client or app layers";

const relativePrefixPattern = String.raw`(?:\.\.?\/)+`;
const intermediateSegmentsPattern = String.raw`(?:[^/]+\/)*`;
const clientForbiddenPattern = String.raw`^(?:@\/server(?:\/|$)|${relativePrefixPattern}${intermediateSegmentsPattern}server(?:\/|$))`;
const serverForbiddenPattern = String.raw`^(?:@\/(?:app|client|components)(?:\/|$)|${relativePrefixPattern}${intermediateSegmentsPattern}(?:app|client|components)(?:\/|$))`;
const sharedForbiddenPattern = String.raw`^(?:(?:react|react-dom|next)(?:\/|$)|node:|(?:assert|async_hooks|buffer|child_process|cluster|crypto|dgram|dns|events|fs|http|http2|https|module|net|os|path|perf_hooks|process|querystring|readline|stream|string_decoder|timers|tls|tty|url|util|v8|vm|worker_threads|zlib)(?:\/|$)|@\/(?:app|client|server|components)(?:\/|$)|${relativePrefixPattern}${intermediateSegmentsPattern}(?:app|client|server|components)(?:\/|$))`;

const nodeBuiltins = "assert|async_hooks|buffer|child_process|cluster|crypto|dgram|dns|events|fs|http|http2|https|module|net|os|path|perf_hooks|process|querystring|readline|stream|string_decoder|timers|tls|tty|url|util|v8|vm|worker_threads|zlib".split("|").flatMap((name) => [name, `${name}/*`]);

function restrictedDynamicImports(pattern, message) {
  return [
    {
      selector: `ImportExpression[source.value=/${pattern}/]`,
      message,
    },
    {
      selector: `ImportExpression > TemplateLiteral[expressions.length=0][quasis.0.value.cooked=/${pattern}/]`,
      message,
    },
    {
      selector: `CallExpression[callee.name="require"][arguments.0.value=/${pattern}/]`,
      message,
    },
    {
      selector: `CallExpression[callee.name="require"] > TemplateLiteral.arguments:first-child[expressions.length=0][quasis.0.value.cooked=/${pattern}/]`,
      message,
    },
  ];
}

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
    files: [
      "client/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      "components/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      "server/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      "shared/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
    ],
    rules: {
      "import/no-restricted-paths": [
        "error",
        {
          basePath: ".",
          zones: [
            {
              target: ["./client", "./components"],
              from: "./server",
              message: clientLayerMessage,
            },
            {
              target: "./server",
              from: ["./client", "./components", "./app"],
              message: serverLayerMessage,
            },
            {
              target: "./shared",
              from: ["./app", "./client", "./server", "./components"],
              message: sharedLayerMessage,
            },
          ],
        },
      ],
    },
  },
  {
    files: ["shared/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
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
                ...nodeBuiltins,
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
      "no-restricted-syntax": [
        "error",
        ...restrictedDynamicImports(sharedForbiddenPattern, sharedLayerMessage),
      ],
    },
  },
  {
    files: ["client/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}", "components/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
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
      "no-restricted-syntax": [
        "error",
        ...restrictedDynamicImports(clientForbiddenPattern, clientLayerMessage),
      ],
    },
  },
  {
    files: ["server/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
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
      "no-restricted-syntax": [
        "error",
        ...restrictedDynamicImports(serverForbiddenPattern, serverLayerMessage),
      ],
    },
  },
]);

export default eslintConfig;
