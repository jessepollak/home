import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const sharedLayerMessage =
  "shared modules must remain runtime-agnostic and independent of web application layers";
const clientLayerMessage = "client modules must not import the server layer";
const browserSdkMessage =
  "browser wallet provider SDKs belong behind the client/account owner-generation fence";
const baseUiMessage =
  "@base-ui/react primitives may only be imported by owned components/ui wrappers";
const literalStyleMessage =
  "Use semantic theme tokens instead of color, radius, or size literals in utility strings.";
const serverLayerMessage = "server modules must not import web client or app layers";
const baseUiImportRestriction = {
  group: ["@base-ui/react", "@base-ui/react/**"],
  message: baseUiMessage,
};

const relativePrefixPattern = String.raw`(?:\.\.?\/)+`;
const intermediateSegmentsPattern = String.raw`(?:[^/]+\/)*`;
const clientForbiddenPattern = String.raw`^(?:@\/server(?:\/|$)|${relativePrefixPattern}${intermediateSegmentsPattern}server(?:\/|$))`;
const serverForbiddenPattern = String.raw`^(?:@\/(?:app|client|components)(?:\/|$)|${relativePrefixPattern}${intermediateSegmentsPattern}(?:app|client|components)(?:\/|$))`;
const sharedForbiddenPattern = String.raw`^(?:(?:react|react-dom|next)(?:\/|$)|node:|(?:assert|async_hooks|buffer|child_process|cluster|crypto|dgram|dns|events|fs|http|http2|https|module|net|os|path|perf_hooks|process|querystring|readline|stream|string_decoder|timers|tls|tty|url|util|v8|vm|worker_threads|zlib)(?:\/|$)|@\/(?:app|client|server|components)(?:\/|$)|${relativePrefixPattern}${intermediateSegmentsPattern}(?:app|client|server|components)(?:\/|$))`;

const nodeBuiltins = "assert|async_hooks|buffer|child_process|cluster|crypto|dgram|dns|events|fs|http|http2|https|module|net|os|path|perf_hooks|process|querystring|readline|stream|string_decoder|timers|tls|tty|url|util|v8|vm|worker_threads|zlib".split("|").flatMap((name) => [name, `${name}/*`]);

// Baseline allowlists contain today's production violators. Entries only shrink
// as files adopt @home/ui; do not add new files to make a lint failure pass.
const rawButtonAllowlist = [
  "client/landing/supported-globe.tsx",
];

const rawFieldAllowlist = [];

const formattingSyntaxAllowlist = [
  // These calls format geometry, not money.
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

const literalStylePattern = String.raw`(?:#[0-9a-fA-F]{3,8}|rgba?\(|(?:[a-z-]+:)*-?(?:rounded|text|size|w|h|min-w|max-w|min-h|max-h|p[trblxy]?|m[trblxy]?|gap|space-[xy]|inset(?:-[xy])?|top|right|bottom|left|ring|outline|border)-\[(?![^\]]*var\(--)[^\]]*(?:px|rem)[^\]]*\]|(?:^|\s)(?:[a-z-]+:)*(?:bg|text|border|ring|outline|fill|stroke)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-|\x2f|\s|$))`;
const literalStyleRestrictions = [
  {
    selector: `JSXAttribute[name.name='className'] > Literal[value=/${literalStylePattern}/]`,
    message: literalStyleMessage,
  },
  {
    selector: `JSXAttribute[name.name='className'] > JSXExpressionContainer Literal[value=/${literalStylePattern}/]`,
    message: literalStyleMessage,
  },
  {
    selector: `JSXAttribute[name.name='className'] TemplateElement[value.raw=/${literalStylePattern}/]`,
    message: literalStyleMessage,
  },
  {
    selector: `CallExpression[callee.name=/^(?:cn|cva)$/] Literal[value=/${literalStylePattern}/]`,
    message: literalStyleMessage,
  },
  {
    selector: `CallExpression[callee.name=/^(?:cn|cva)$/] TemplateElement[value.raw=/${literalStylePattern}/]`,
    message: literalStyleMessage,
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

const serverOnlyPlugin = {
  rules: {
    "require-server-only": {
      meta: {
        type: "problem",
        messages: {
          missing:
            'Server modules must start with `import "server-only";` to follow Vercel\'s server-only guidance and prevent accidental client imports.',
        },
        schema: [],
      },
      create(context) {
        return {
          Program(node) {
            const firstImport = node.body.find((statement) => statement.type === "ImportDeclaration");
            if (firstImport?.source.value === "server-only" && firstImport.specifiers.length === 0) return;

            context.report({
              node: firstImport ?? node,
              messageId: "missing",
            });
          },
        };
      },
    },
  },
};

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
            baseUiImportRestriction,
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
            baseUiImportRestriction,
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        ...restrictedDynamicImports(clientForbiddenPattern, clientLayerMessage),
        ...literalStyleRestrictions,
      ],
    },
  },
  {
    files: ["components/ui/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
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
            baseUiImportRestriction,
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
            baseUiImportRestriction,
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
          patterns: [baseUiImportRestriction],
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
            baseUiImportRestriction,
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        ...restrictedDynamicImports(serverForbiddenPattern, serverLayerMessage),
      ],
    },
  },
  {
    files: ["server/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    ignores: ["**/*.test.{js,jsx,mjs,cjs,ts,tsx,mts,cts}", "**/*.d.ts"],
    plugins: { "server-only": serverOnlyPlugin },
    rules: {
      "server-only/require-server-only": "error",
    },
  },
  // These final client/component blocks preserve the import-boundary syntax
  // checks while applying the raw-element allowlists independently.
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
        ...literalStyleRestrictions,
      ],
    },
  },
  {
    files: [
      "client/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      "components/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
    ],
    ignores: [...new Set([...rawButtonAllowlist, ...formattingSyntaxAllowlist]), "**/*.test.{ts,tsx}", "**/tests/**", "components/ui/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...restrictedDynamicImports(clientForbiddenPattern, clientLayerMessage),
        ...formattingSyntaxRestrictions,
        ...literalStyleRestrictions,
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
    ignores: [...new Set([...rawFieldAllowlist, ...formattingSyntaxAllowlist]), "**/*.test.{ts,tsx}", "**/tests/**", "components/ui/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...restrictedDynamicImports(clientForbiddenPattern, clientLayerMessage),
        ...formattingSyntaxRestrictions,
        ...literalStyleRestrictions,
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
    ignores: [...new Set([...rawButtonAllowlist, ...rawFieldAllowlist, ...formattingSyntaxAllowlist]), "**/*.test.{ts,tsx}", "**/tests/**", "components/ui/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...restrictedDynamicImports(clientForbiddenPattern, clientLayerMessage),
        ...formattingSyntaxRestrictions,
        ...literalStyleRestrictions,
        {
          selector: "JSXOpeningElement[name.name='button']",
          message: "Use Button or IconButton from @home/ui. The raw-button allowlist only shrinks.",
        },
        {
          selector: "JSXOpeningElement[name.name=/^(?:input|select)$/]",
          message: "Use Input or Select from @home/ui. The raw-field allowlist only shrinks.",
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
        ...literalStyleRestrictions,
        {
          selector: "JSXOpeningElement[name.name='button']",
          message: "Use Button or IconButton from @home/ui. The raw-button allowlist only shrinks.",
        },
      ],
    },
  },
]);

export default eslintConfig;
