import path from "node:path";

const fullPresenters = new Set(["presentBalances", "presentMoneyGroups", "presentBalanceRows"]);
const listOwner = "client/home/balances-panel.tsx";

function filenameWithinWeb(filename) {
  const normalized = String(filename ?? "").replaceAll("\\", "/");
  const root = normalized.lastIndexOf("/apps/web/");
  if (root >= 0) return normalized.slice(root + "/apps/web/".length);
  const segments = normalized.split("/");
  const layer = segments.findIndex((segment) => ["app", "client", "components", "shared", "server", "config", "lib", "types"].includes(segment));
  return segments.slice(layer < 0 ? 0 : layer).join("/");
}

function staticSources(node) {
  if (!node) return [];
  if (["ParenthesizedExpression", "TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion"].includes(node.type)) return staticSources(node.expression);
  if (["Literal", "StringLiteral"].includes(node.type)) return typeof node.value === "string" ? [node.value] : [];
  if (node.type === "ConditionalExpression") return [...staticSources(node.consequent), ...staticSources(node.alternate)];
  if (node.type === "LogicalExpression") return [...staticSources(node.left), ...staticSources(node.right)];
  if (node.type === "BinaryExpression" && node.operator === "+") {
    return staticSources(node.left).flatMap((left) => staticSources(node.right).map((right) => left + right));
  }
  if (node.type === "TemplateLiteral") {
    let values = [""];
    for (const [index, quasi] of node.quasis.entries()) {
      values = values.map((value) => value + quasi.value.cooked);
      if (index < node.expressions.length) values = values.flatMap((value) => staticSources(node.expressions[index]).map((part) => value + part));
    }
    return values;
  }
  return [];
}

function isPresenter(source, filename) {
  const resolved = source.startsWith("@/") ? path.posix.normalize(source.slice(2))
    : source.startsWith(".") ? path.posix.normalize(path.posix.join(path.posix.dirname(filename), source)) : null;
  return resolved?.replace(/\.[cm]?[jt]sx?$/u, "") === "shared/balances/present";
}

export const noFullPortfolioPresentation = {
  meta: {
    type: "problem", schema: [],
    messages: { rejected: "Full portfolio presenters belong only to the active Balances list. Use named summary, cash or visible-row presenters; see docs/investments-performance.md." },
  },
  create(context) {
    const filename = filenameWithinWeb(context.filename);
    function check(source, node) {
      if (!staticSources(source).some((value) => isPresenter(value, filename))) return;
      if (node.importKind === "type" || node.exportKind === "type") return;
      if (node.type === "ImportDeclaration" || node.type === "ExportNamedDeclaration") {
        const runtime = node.specifiers.filter((specifier) => specifier.importKind !== "type" && specifier.exportKind !== "type");
        const allowed = runtime.every((specifier) => {
          if (!["ImportSpecifier", "ExportSpecifier"].includes(specifier.type)) return false;
          const name = specifier.imported?.name ?? specifier.imported?.value ?? specifier.local?.name ?? specifier.local?.value;
          if (name === "default") return false;
          return !fullPresenters.has(name) || node.type === "ImportDeclaration" && filename === listOwner;
        });
        if (allowed) return;
      }
      context.report({ node: source, messageId: "rejected" });
    }
    return {
      ImportDeclaration(node) { check(node.source, node); },
      ExportNamedDeclaration(node) { if (node.source) check(node.source, node); },
      ExportAllDeclaration(node) { check(node.source, node); },
      ImportExpression(node) { check(node.source, node); },
      TSImportEqualsDeclaration(node) {
        if (node.moduleReference.type === "TSExternalModuleReference") check(node.moduleReference.expression, node);
      },
      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "require") check(node.arguments[0], node);
      },
    };
  },
};
