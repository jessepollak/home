import path from "node:path";

const productionIsolationMessage =
  "Storybook and MSW are development-only; production modules must not import workshop packages, config, or stories";
const sharedLayerMessage =
  "shared modules must remain runtime-agnostic and independent of web application layers";
const clientLayerMessage = "client modules must not import the server layer";
const serverLayerMessage = "server modules must not import web client or app layers";
const browserSdkMessage =
  "browser wallet provider SDKs belong behind the client/account owner-generation fence";
const baseUiMessage =
  "@base-ui/react primitives may only be imported by owned components/ui wrappers";
const locationMessage = "Do not assign a relative URL to location; use an absolute path or URL.";

function sourceValue(node) {
  if (node?.type === "Literal" || node?.type === "StringLiteral") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked;
  }
  return undefined;
}

function sourceVisitors(check) {
  return {
    ImportDeclaration(node) { check(node.source); },
    ExportNamedDeclaration(node) { if (node.source) check(node.source); },
    ExportAllDeclaration(node) { check(node.source); },
    ImportExpression(node) { check(node.source); },
    CallExpression(node) {
      if (node.callee.type === "Identifier" && node.callee.name === "require") check(node.arguments[0]);
    },
  };
}

function rule(message, reject) {
  return {
    meta: { type: "problem", schema: [], messages: { rejected: message } },
    create(context) {
      return sourceVisitors((node) => {
        const value = sourceValue(node);
        if (typeof value === "string" && reject(value, context.filename)) {
          context.report({ node, messageId: "rejected" });
        }
      });
    },
  };
}

function isStorybookImport(value) {
  return /^(?:@storybook|storybook|msw|msw-storybook-addon)(?:\/|$)/.test(value)
    || /(?:^|\/)\.storybook(?:\/|$)/.test(value)
    || /(?:^|\/)[^/]+\.stories(?:\.|$)/.test(value);
}

function normalizedFilename(filename) {
  return String(filename ?? "").replaceAll("\\", "/");
}

function layerForImport(value, filename) {
  if (value.startsWith("@/")) return value.slice(2).split("/")[0];
  if (!value.startsWith(".")) return null;
  const importer = normalizedFilename(filename);
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(importer), value));
  for (const segment of resolved.split("/")) {
    if (["app", "client", "components", "server", "shared"].includes(segment)) return segment;
  }
  return null;
}

const nodeBuiltins = new Set(
  "assert async_hooks buffer child_process cluster crypto dgram dns events fs http http2 https module net os path perf_hooks process querystring readline stream string_decoder timers tls tty url util v8 vm worker_threads zlib".split(" "),
);

function packageRoot(value) {
  if (value.startsWith("@")) return value.split("/").slice(0, 2).join("/");
  return value.split("/")[0];
}

export const noStorybookImports = rule(productionIsolationMessage, isStorybookImport);

export const noClientServerImports = rule(clientLayerMessage, (value, filename) => {
  const current = layerForFilename(filename);
  return (current === "client" || current === "components") && layerForImport(value, filename) === "server";
});

export const noServerClientImports = rule(serverLayerMessage, (value, filename) => {
  if (layerForFilename(filename) !== "server") return false;
  return ["app", "client", "components"].includes(layerForImport(value, filename));
});

export const noSharedRuntimeImports = rule(sharedLayerMessage, (value, filename) => {
  if (layerForFilename(filename) !== "shared") return false;
  const root = packageRoot(value.replace(/^node:/, ""));
  return ["react", "react-dom", "next"].includes(root)
    || value.startsWith("node:")
    || nodeBuiltins.has(root)
    || ["app", "client", "server", "components"].includes(layerForImport(value, filename));
});

function layerForFilename(filename) {
  const segments = normalizedFilename(filename).split("/");
  return segments.find((segment) => ["app", "client", "components", "server", "shared"].includes(segment)) ?? null;
}

export const noBrowserSdkImports = rule(browserSdkMessage, (value, filename) => {
  const root = packageRoot(value);
  if (!(root.startsWith("@coinbase/cdp-") || root === "@base-org/account")) return false;
  const file = normalizedFilename(filename);
  const layer = layerForFilename(file);
  if (!["app", "client", "components", "shared"].includes(layer)) return false;
  return !file.includes("/client/account/") && !file.startsWith("client/account/");
});

export const noBaseUiImports = rule(baseUiMessage, (value, filename) => {
  if (packageRoot(value) !== "@base-ui/react") return false;
  const file = normalizedFilename(filename);
  return !file.includes("/components/ui/") && !file.startsWith("components/ui/");
});

function isLocationObject(node) {
  return node?.type === "Identifier" && (node.name === "location" || node.name === "window");
}

function isRelative(value) {
  return typeof value === "string" && !/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(value);
}

export const noRelativeLocationAssignment = {
  meta: { type: "problem", schema: [], messages: { rejected: locationMessage } },
  create(context) {
    function checkArgument(node) {
      if (isRelative(sourceValue(node))) context.report({ node, messageId: "rejected" });
    }
    return {
      AssignmentExpression(node) {
        const left = node.left;
        if (left.type !== "MemberExpression" || left.computed) return;
        if (left.property.type !== "Identifier" || left.property.name !== "href") return;
        if (isLocationObject(left.object)
          || (left.object.type === "MemberExpression" && !left.object.computed
            && isLocationObject(left.object.object) && left.object.property.name === "location")) {
          checkArgument(node.right);
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.computed) return;
        if (callee.property.type !== "Identifier" || !["assign", "replace"].includes(callee.property.name)) return;
        if (isLocationObject(callee.object)
          || (callee.object.type === "MemberExpression" && !callee.object.computed
            && isLocationObject(callee.object.object) && callee.object.property.name === "location")) {
          checkArgument(node.arguments[0]);
        }
      },
    };
  },
};
