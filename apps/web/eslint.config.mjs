import { defineConfig, globalIgnores } from "eslint/config";
import { plugin as shadcn } from "@shadcn/lint";
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
  "Use semantic theme tokens instead of hex/rgba, arbitrary-px, or raw palette colors in utility strings.";
const serverLayerMessage = "server modules must not import web client or app layers";
const testsReadSourceMessage = "tests must not read source files; assert behavior instead";
const testsAssertBehaviorMessage = "tests must assert behavior, not CSS classes";
const storybookIsolationMessage =
  "Storybook and MSW are development-only; production modules must not import workshop packages, config, or stories";
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
// as files adopt owned UI wrappers; do not add new files to make a lint failure pass.
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

// Stock Tailwind scale utilities (for example text-sm, rounded-md, and p-4) are allowed.
const literalStylePattern = String.raw`(?:#[0-9a-fA-F]{3,8}|rgba?\(|(?:^|\s)(?:[a-z-]+:)*-?(?:rounded|text|size|w|h|min-w|max-w|min-h|max-h|p[trblxy]?|m[trblxy]?|gap|space-[xy]|inset(?:-[xy])?|top|right|bottom|left|ring|outline|border)-\[(?![^\]]*var\(--)(?=[^\]]*px)[^\]]+\]|(?:^|\s)(?:[a-z-]+:)*(?:bg|text|border|ring|outline|fill|stroke)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-|\x2f|\s|$))`;
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

function isStorybookOnlyImport(value) {
  return typeof value === "string" && (
    /^(?:@storybook|storybook|msw|msw-storybook-addon)(?:\/|$)/.test(value)
    || /(?:^|\/)\.storybook(?:\/|$)/.test(value)
    || /(?:^|\/)[^/]+\.stories(?:\.|$)/.test(value)
  );
}

const productionIsolationPlugin = {
  rules: {
    "no-storybook-imports": {
      meta: {
        type: "problem",
        schema: [],
      },
      create(context) {
        function sourceValue(node) {
          if (node?.type === "Literal") return node.value;
          if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
            return node.quasis[0]?.value.cooked;
          }
          return undefined;
        }

        function checkSource(node) {
          if (isStorybookOnlyImport(sourceValue(node))) {
            context.report({ node, message: storybookIsolationMessage });
          }
        }

        return {
          ImportDeclaration(node) {
            checkSource(node.source);
          },
          ExportNamedDeclaration(node) {
            if (node.source) checkSource(node.source);
          },
          ExportAllDeclaration(node) {
            checkSource(node.source);
          },
          ImportExpression(node) {
            checkSource(node.source);
          },
          CallExpression(node) {
            if (node.callee.type === "Identifier" && node.callee.name === "require") {
              checkSource(node.arguments[0]);
            }
          },
        };
      },
    },
  },
};

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

// Home-owned test policy. These live behind plugin rule IDs rather than the
// core no-restricted-imports/no-restricted-syntax rules so the layer boundary
// rules keep their own options for test files: core rule options replace, they
// do not compose.
const testPolicyPlugin = {
  rules: {
    "no-source-reads": {
      meta: {
        type: "problem",
        messages: { rejected: testsReadSourceMessage },
        schema: [],
      },
      create(context) {
        function sourceValue(node) {
          if (node?.type === "Literal") return node.value;
          if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
            return node.quasis[0]?.value.cooked;
          }
          return undefined;
        }

        function checkSource(node) {
          const value = sourceValue(node);
          if (
            value === "fs"
            || value === "node:fs"
            || value === "fs/promises"
            || value === "node:fs/promises"
          ) {
            context.report({ node, messageId: "rejected" });
          }
        }

        return {
          ImportDeclaration(node) {
            checkSource(node.source);
          },
          ExportNamedDeclaration(node) {
            if (node.source) checkSource(node.source);
          },
          ExportAllDeclaration(node) {
            checkSource(node.source);
          },
          ImportExpression(node) {
            checkSource(node.source);
          },
          CallExpression(node) {
            const callee = node.callee;
            if (callee.type === "Identifier" && callee.name === "require") {
              checkSource(node.arguments[0]);
            }
            if (
              callee.type === "MemberExpression"
              && !callee.computed
              && callee.object.type === "Identifier"
              && callee.object.name === "Bun"
              && callee.property.type === "Identifier"
              && callee.property.name === "file"
            ) {
              context.report({ node, messageId: "rejected" });
            }
          },
        };
      },
    },
    "no-real-waits": {
      meta: {
        type: "problem",
        messages: {
          delay: "tests must use fake timers instead of real delays over 50ms",
          sleep: "tests must not sleep; use fake timers or an injected scheduler",
          wait: "tests must not wait longer than 2000ms; bound the wait deterministically",
        },
        schema: [],
      },
      create(context) {
        return {
          CallExpression(node) {
            const callee = node.callee;
            if (
              callee.type === "Identifier"
              && (callee.name === "setTimeout" || callee.name === "setInterval")
            ) {
              const delay = node.arguments[1];
              if (delay?.type === "Literal" && typeof delay.value === "number" && delay.value > 50) {
                context.report({ node: delay, messageId: "delay" });
              }
            }
            if (
              callee.type === "MemberExpression"
              && !callee.computed
              && callee.object.type === "Identifier"
              && callee.object.name === "Bun"
              && callee.property.type === "Identifier"
              && callee.property.name === "sleep"
            ) {
              context.report({ node, messageId: "sleep" });
            }
            if (callee.type === "Identifier" && callee.name === "waitFor") {
              const options = node.arguments[1];
              if (options?.type === "ObjectExpression") {
                for (const property of options.properties) {
                  if (
                    property.type === "Property"
                    && !property.computed
                    && property.key.type === "Identifier"
                    && property.key.name === "timeout"
                    && property.value.type === "Literal"
                    && typeof property.value.value === "number"
                    && property.value.value > 2000
                  ) {
                    context.report({ node: property.value, messageId: "wait" });
                  }
                }
              }
            }
          },
        };
      },
    },
    "no-presentation-class-reads": {
      meta: {
        type: "problem",
        messages: { rejected: testsAssertBehaviorMessage },
        schema: [],
      },
      create(context) {
        const mutationMethods = new Set(["add", "remove", "toggle", "replace"]);

        // Arrange-phase writes are setup, not assertions: a className assignment
        // or a classList mutation call is allowed, any read is not.
        function isWrite(node) {
          const parent = node.parent;
          if (parent.type === "AssignmentExpression" && parent.left === node) return true;
          return (
            parent.type === "MemberExpression"
            && parent.object === node
            && parent.property.type === "Identifier"
            && mutationMethods.has(parent.property.name)
            && parent.parent.type === "CallExpression"
            && parent.parent.callee === parent
          );
        }

        return {
          MemberExpression(node) {
            if (node.computed || node.property.type !== "Identifier") return;
            if (node.property.name !== "className" && node.property.name !== "classList") return;
            if (isWrite(node)) return;
            context.report({ node, messageId: "rejected" });
          },
          CallExpression(node) {
            const callee = node.callee;
            if (
              callee.type === "MemberExpression"
              && !callee.computed
              && callee.property.type === "Identifier"
              && callee.property.name === "getAttribute"
            ) {
              const attribute = node.arguments[0];
              if (attribute?.type === "Literal" && attribute.value === "class") {
                context.report({ node, messageId: "rejected" });
              }
            }
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
    "storybook-static/**",
    ".storybook/static/mockServiceWorker.js",
    "next-env.d.ts",
  ]),
  // Keep development-only workshop code unreachable from production entrypoints.
  {
    files: [
      "app/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      "client/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      "components/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      "config/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      "lib/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      "server/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      "shared/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      "types/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      // Root production/build entrypoints that sit outside the layered directories.
      "instrumentation*.ts",
      "next.config.ts",
      "proxy.ts",
    ],
    ignores: ["**/*.stories.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    plugins: { "production-isolation": productionIsolationPlugin },
    rules: {
      "production-isolation/no-storybook-imports": "error",
    },
  },
  // Product code may only use layout classes on owned UI components.
  {
    files: [
      "app/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      "client/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      "components/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
    ],
    ignores: ["**/*.test.{js,jsx,mjs,cjs,ts,tsx,mts,cts}", "**/tests/**"],
    plugins: { shadcn },
    rules: {
      "shadcn/no-restyle": [
        "error",
        {
          allow: ["layout"],
        },
      ],
    },
  },
  {
    files: ["components/ui/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    rules: {
      "shadcn/no-restyle": "off",
    },
  },
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
          message: "Use Button from @/components/ui/button. The raw-button allowlist only shrinks.",
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
          message: "Use Input or Select from @/components/ui. The raw-field allowlist only shrinks.",
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
          message: "Use Button from @/components/ui/button. The raw-button allowlist only shrinks.",
        },
        {
          selector: "JSXOpeningElement[name.name=/^(?:input|select)$/]",
          message: "Use Input or Select from @/components/ui. The raw-field allowlist only shrinks.",
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
          message: "Use Button from @/components/ui/button. The raw-button allowlist only shrinks.",
        },
      ],
    },
  },
  // Test-only policy: assert behavior, never source text, real sleeps, or CSS
  // classes. The rules live behind distinct test-policy plugin IDs so the
  // per-layer no-restricted-imports/no-restricted-syntax boundary rules keep
  // applying to test files instead of being replaced by this block.
  {
    files: ["**/*.test.{ts,tsx}", "tests/helpers/**/*.{ts,tsx}"],
    ignores: ["**/migrations/**"],
    plugins: { "test-policy": testPolicyPlugin },
    rules: {
      "test-policy/no-source-reads": "error",
      "test-policy/no-real-waits": "error",
      "test-policy/no-presentation-class-reads": "error",
    },
  },
  // tests/helpers/migrations.ts is the sole fs/promises seam for integration
  // fixtures that apply committed schema migrations, and the Apple Pay test
  // reads a shipped public asset to hash it rather than asserting source text.
  // Both carve out only the source-read rule; the other test-policy rules stay on.
  {
    files: [
      "tests/helpers/migrations.ts",
      "tests/well-known/apple-pay-domain-association.test.ts",
    ],
    rules: {
      "test-policy/no-source-reads": "off",
    },
  },
]);

export default eslintConfig;
