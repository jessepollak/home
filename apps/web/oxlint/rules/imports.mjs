import path from "node:path";

const productionIsolationMessage =
  "Storybook and MSW are development-only; production modules must not import workshop packages, config, or stories";
const explorationIsolationMessage =
  "Exploration code is design-lane only; production modules must not import or re-export from explorations/";
const testSupportIsolationMessage =
  "Test-support code is not production code; production modules must not import tests/, testing/, *.test.* modules, or test harnesses";
const sharedLayerMessage =
  "shared modules must remain runtime-agnostic and independent of web application layers";
const clientLayerMessage = "client modules must not import the server layer";
const serverLayerMessage = "server modules must not import web client or app layers";
const browserSdkMessage =
  "browser wallet provider SDKs belong behind the client/account owner-generation fence";
const baseUiMessage =
  "@base-ui/react primitives may only be imported by owned components/ui wrappers";
const locationMessage = "Do not assign a relative URL to location; use an absolute path or URL.";
const classicZodMessage = "shared, client, and components modules must import zod/mini instead of classic zod";

function sourceValue(node) {
  if (node?.type === "Literal" || node?.type === "StringLiteral") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked;
  }
  return undefined;
}

const assertionNodes = ["ParenthesizedExpression", "TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion", "TypeAssertionExpression"];
const unknownSegment = Symbol("unknown");

function mergeSegments(left, right) {
  if (!left.length) return right;
  if (!right.length) return left;
  const last = left.at(-1);
  const first = right[0];
  if (typeof last === "string" && typeof first === "string") return [...left.slice(0, -1), last + first, ...right.slice(1)];
  return [...left, ...right];
}

const alternativeKey = (alternative) => JSON.stringify(alternative.map((segment) => (typeof segment === "string" ? segment : null)));

function dedupeAlternatives(alternatives) {
  const seen = new Set();
  return alternatives.filter((alternative) => {
    const key = alternativeKey(alternative);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function combineSegments(lefts, rights) {
  const combined = [];
  const seenMerged = new Set();
  let evaluated = 0;
  const distinctLefts = dedupeAlternatives(lefts);
  const distinctRights = dedupeAlternatives(rights);
  for (const left of distinctLefts) for (const right of distinctRights) {
    evaluated += 1;
    if (evaluated > 16384) return [widenSegments([...combined, ...lefts, ...rights])];
    const merged = mergeSegments(left, right);
    const key = alternativeKey(merged);
    if (seenMerged.has(key)) continue;
    seenMerged.add(key);
    combined.push(merged);
    if (combined.length > 4096) return [widenSegments([...combined, ...lefts, ...rights])];
  }
  return combined;
}

// A pathological alternative count must not erase known segments and let a
// definite exploration import through, so widen the constructed alternatives
// into one fail-closed sequence of every known segment seen.
function widenSegments(alternatives) {
  const segments = [unknownSegment];
  const seen = new Set();
  for (const alternative of alternatives) for (const segment of alternative) {
    if (typeof segment !== "string" || !segment.length || seen.has(segment)) continue;
    seen.add(segment);
    segments.push(segment);
  }
  return segments;
}


function segmentAlternatives(node) {
  if (node == null) return [[unknownSegment]];
  if (assertionNodes.includes(node?.type)) return segmentAlternatives(node.expression);
  if (node?.type === "Literal" || node?.type === "StringLiteral") return typeof node.value === "string" ? [[node.value]] : [[unknownSegment]];
  if (node?.type === "BinaryExpression" && node.operator === "+") return combineSegments(segmentAlternatives(node.left), segmentAlternatives(node.right));
  if (node?.type === "ConditionalExpression") return [...segmentAlternatives(node.consequent), ...segmentAlternatives(node.alternate)];
  if (node?.type === "LogicalExpression") return [...segmentAlternatives(node.left), ...segmentAlternatives(node.right)];
  if (node?.type !== "TemplateLiteral") return [[unknownSegment]];
  let alternatives = [[]];
  for (const [index, quasi] of node.quasis.entries()) {
    const cooked = quasi.value.cooked;
    alternatives = combineSegments(alternatives, [[typeof cooked === "string" ? cooked : unknownSegment]]);
    if (index < node.expressions.length) alternatives = combineSegments(alternatives, segmentAlternatives(node.expressions[index]));
  }
  return alternatives;
}

function sourceVisitors(check) {
  function visit(node) {
    for (const segments of segmentAlternatives(node)) {
      const complete = segments.length === 1 && typeof segments[0] === "string";
      for (const segment of segments) {
        if (typeof segment === "string" && segment.length) check(node, segment, complete);
      }
    }
  }
  return {
    ImportDeclaration(node) { visit(node.source); },
    ExportNamedDeclaration(node) { if (node.source) visit(node.source); },
    ExportAllDeclaration(node) { visit(node.source); },
    ImportExpression(node) { visit(node.source); },
    TSImportType(node) { visit(node.source); },
    CallExpression(node) {
      if (node.callee.type === "Identifier" && node.callee.name === "require") visit(node.arguments[0]);
    },
  };
}

function rule(message, reject) {
  return {
    meta: { type: "problem", schema: [], messages: { rejected: message } },
    create(context) {
      const reported = new WeakSet();
      return sourceVisitors((node, value, complete) => {
        if (typeof value !== "string" || reported.has(node) || !reject(value, context.filename, complete)) return;
        reported.add(node);
        context.report({ node, messageId: "rejected" });
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

// Normalize the specifier, not the importer path, so checkout ancestry cannot change classification; fully normalize complete specifiers, but preserve a fragment's trailing .. because an unknown expression may continue that segment.
function normalizedSpecifier(value, complete) {
  const normalized = value.replaceAll("\\", "/").replace(/^@\//, "");
  const partialTraversal = !complete && /(?:^|\/)\.\.$/.test(normalized);
  const resolved = path.posix.normalize(partialTraversal ? normalized.slice(0, -2) : normalized);
  return partialTraversal ? `${resolved}/..` : resolved;
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
export const noExplorationImports = rule(explorationIsolationMessage, (value) =>
  /(?:^|\/)explorations(?:\/|$)/.test(value));
export const noTestSupportImports = rule(testSupportIsolationMessage, (value, _filename, complete) => {
  const specifier = normalizedSpecifier(value, complete);
  return /(?:^|\/)(?:tests|testing)(?:\/|$)/.test(specifier)
    || /\.test(?:\.[^/]+)?$/.test(specifier)
    || /(?:^|\/)[^/]*test-harness(?:\.[^/]+)?$/.test(specifier);
});
export const noClassicZodImports = rule(classicZodMessage, (value) =>
  value !== "zod/mini" && (value === "zod" || value.startsWith("zod/")));

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
