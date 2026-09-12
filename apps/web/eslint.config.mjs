import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const sharedLayerMessage =
  "shared modules must remain runtime-agnostic and independent of web application layers";
const clientLayerMessage = "client modules must not import the server layer";
const browserSdkMessage =
  "browser wallet provider SDKs belong behind the client/account owner-generation fence";
const serverLayerMessage = "server modules must not import web client or app layers";

const relativePrefixPattern = String.raw`(?:\.\.?\/)+`;
const intermediateSegmentsPattern = String.raw`(?:[^/]+\/)*`;
const clientForbiddenPattern = String.raw`^(?:@\/server(?:\/|$)|${relativePrefixPattern}${intermediateSegmentsPattern}server(?:\/|$))`;
const serverForbiddenPattern = String.raw`^(?:@\/(?:app|client|components)(?:\/|$)|${relativePrefixPattern}${intermediateSegmentsPattern}(?:app|client|components)(?:\/|$))`;
const sharedForbiddenPattern = String.raw`^(?:(?:react|react-dom|next)(?:\/|$)|node:|(?:assert|async_hooks|buffer|child_process|cluster|crypto|dgram|dns|events|fs|http|http2|https|module|net|os|path|perf_hooks|process|querystring|readline|stream|string_decoder|timers|tls|tty|url|util|v8|vm|worker_threads|zlib)(?:\/|$)|@\/(?:app|client|server|components)(?:\/|$)|${relativePrefixPattern}${intermediateSegmentsPattern}(?:app|client|server|components)(?:\/|$))`;

const nodeBuiltins = "assert|async_hooks|buffer|child_process|cluster|crypto|dgram|dns|events|fs|http|http2|https|module|net|os|path|perf_hooks|process|querystring|readline|stream|string_decoder|timers|tls|tty|url|util|v8|vm|worker_threads|zlib".split("|").flatMap((name) => [name, `${name}/*`]);

// Baseline allowlists contain today's production violators. Entries only shrink
// as files adopt @home/ui; do not add new files to make a lint failure pass.
const rawButtonAllowlist = [
  "client/activity/activity-panel.tsx",
  "client/funding/add-money-dialog.tsx",
  "client/funding/funding-actions.tsx",
  "client/funding/order-flow.tsx",
  "client/home/home-panel.tsx",
  "client/home/shell-chrome.tsx",
  "client/home/shell-panels.tsx",
  "client/invest/price-chart.tsx",
  "client/landing/supported-globe.tsx",
  "client/actions/review.tsx",
  "client/money-modal/amount.tsx",
  "client/money-modal/money-modal.tsx",
  "client/savings/savings-experience.tsx",
  "client/transfers/transfer-actions.tsx",
  "components/address-field.tsx",
  "components/copyable-value.tsx",
  "components/home-mark.tsx",
  "components/primary-navigation.tsx",
  "components/profile-mark.tsx",
];

const rawFieldAllowlist = [
  "client/account/account-screen.tsx",
  "client/funding/add-money-dialog.tsx",
  "client/money-modal/amount.tsx",
];

const rawHeadingAllowlist = [
  "client/activity/activity-panel.tsx",
  "client/funding/add-money-dialog.tsx",
  "client/funding/order-flow.tsx",
  "client/home/home-panel.tsx",
  "client/home/shell-chrome.tsx",
  "client/actions/recent-operations.tsx",
  "client/actions/review.tsx",
  "client/money-modal/money-modal.tsx",
  "client/savings/savings-experience.tsx",
];

const formattingSyntaxAllowlist = [
  // These calls format geometry or discover the browser time zone, not money.
  "client/activity/activity-panel.tsx",
  "client/landing/globe-geometry.ts",
  "client/landing/supported-globe.tsx",
];

const formattingSyntaxRestrictions = [
  {
    selector: "NewExpression[callee.object.name='Intl'][callee.property.name=/^(?:NumberFormat|DateTimeFormat)$/]",
    message: "Use shared/formatting for locale-aware number and date presentation.",
  },
  {
    selector: "CallExpression[callee.property.name=/^toLocale(?:String|DateString|TimeString)$/]",
    message: "Use shared/formatting for locale-aware number and date presentation.",
  },
  {
    selector: "CallExpression[callee.property.name='toFixed']",
    message: "Use shared/formatting for numeric presentation.",
  },
];

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
            {
              group: ["@coinbase/cdp-*", "@coinbase/cdp-*/*", "@base-org/account", "@base-org/account/*"],
              message: browserSdkMessage,
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
            {
              group: ["@coinbase/cdp-*", "@coinbase/cdp-*/*", "@base-org/account", "@base-org/account/*"],
              message: browserSdkMessage,
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
    files: ["client/account/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
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
    files: ["app/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@coinbase/cdp-*", "@coinbase/cdp-*/*", "@base-org/account", "@base-org/account/*"],
              message: browserSdkMessage,
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.test.{ts,tsx}"],
    ignores: ["**/migrations/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "fs",
              message: "tests must not read source files; assert behavior instead",
            },
            {
              name: "node:fs",
              message: "tests must not read source files; assert behavior instead",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.name=/^set(?:Timeout|Interval)$/][arguments.1.type='Literal'][arguments.1.value>50]",
          message: "tests must use fake timers instead of real delays over 50ms",
        },
        {
          selector: "CallExpression[callee.object.name='Bun'][callee.property.name='file']",
          message: "tests must not read source files; assert behavior instead",
        },
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
  // These final client/component blocks preserve the import-boundary syntax
  // checks while applying the two allowlists independently.
  {
    files: [
      "client/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      "components/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
    ],
    ignores: [...formattingSyntaxAllowlist, "**/*.test.{ts,tsx}", "**/tests/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...restrictedDynamicImports(clientForbiddenPattern, clientLayerMessage),
        ...formattingSyntaxRestrictions,
      ],
    },
  },
  {
    files: [
      "client/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      "components/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
    ],
    ignores: [...new Set([...rawButtonAllowlist, ...formattingSyntaxAllowlist]), "**/*.test.{ts,tsx}", "**/tests/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...restrictedDynamicImports(clientForbiddenPattern, clientLayerMessage),
        ...formattingSyntaxRestrictions,
        {
          selector: "JSXOpeningElement[name.name='button']",
          message: "Use Button or IconButton from @home/ui. The raw-button allowlist only shrinks.",
        },
      ],
    },
  },
  {
    files: [
      "client/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      "components/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
    ],
    ignores: [...new Set([...rawHeadingAllowlist, ...formattingSyntaxAllowlist]), "**/*.test.{ts,tsx}", "**/tests/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...restrictedDynamicImports(clientForbiddenPattern, clientLayerMessage),
        ...formattingSyntaxRestrictions,
        {
          selector: "JSXOpeningElement[name.name=/^h[1-4]$/]",
          message: "Use Heading from @home/ui. The raw-heading allowlist only shrinks.",
        },
      ],
    },
  },
  {
    files: [
      "client/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      "components/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
    ],
    ignores: [...new Set([...rawFieldAllowlist, ...formattingSyntaxAllowlist]), "**/*.test.{ts,tsx}", "**/tests/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...restrictedDynamicImports(clientForbiddenPattern, clientLayerMessage),
        ...formattingSyntaxRestrictions,
        {
          selector: "JSXOpeningElement[name.name=/^(?:input|select)$/]",
          message: "Use Input or Select from @home/ui. The raw-field allowlist only shrinks.",
        },
      ],
    },
  },
  {
    files: [
      "client/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      "components/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
    ],
    ignores: [...new Set([...rawButtonAllowlist, ...rawHeadingAllowlist, ...formattingSyntaxAllowlist]), "**/*.test.{ts,tsx}", "**/tests/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...restrictedDynamicImports(clientForbiddenPattern, clientLayerMessage),
        ...formattingSyntaxRestrictions,
        {
          selector: "JSXOpeningElement[name.name='button']",
          message: "Use Button or IconButton from @home/ui. The raw-button allowlist only shrinks.",
        },
        {
          selector: "JSXOpeningElement[name.name=/^h[1-4]$/]",
          message: "Use Heading from @home/ui. The raw-heading allowlist only shrinks.",
        },
      ],
    },
  },
  {
    files: ["shared/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    ignores: ["shared/formatting/**", "**/*.test.{ts,tsx}", "**/tests/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...restrictedDynamicImports(sharedForbiddenPattern, sharedLayerMessage),
        ...formattingSyntaxRestrictions,
      ],
    },
  },
  {
    files: ["app/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    ignores: ["**/*.test.{ts,tsx}", "**/tests/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...formattingSyntaxRestrictions,
        {
          selector: "JSXOpeningElement[name.name='button']",
          message: "Use Button or IconButton from @home/ui. The raw-button allowlist only shrinks.",
        },
        {
          selector: "JSXOpeningElement[name.name=/^h[1-4]$/]",
          message: "Use Heading from @home/ui. The raw-heading allowlist only shrinks.",
        },
      ],
    },
  },
]);

export default eslintConfig;
