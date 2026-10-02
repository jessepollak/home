function staticText(node) {
  if (!node) return "";
  if (node.type === "Literal" || node.type === "StringLiteral") return typeof node.value === "string" ? node.value : "";
  if (node.type === "TemplateLiteral") return node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join(" ");
  if (node.type === "BinaryExpression" && node.operator === "+") return staticText(node.left) + staticText(node.right);
  return "";
}

export const boundedCdpEventQuery = {
  meta: {
    type: "problem", schema: [],
    messages: { rejected: "CDP base.events SQL belongs in server/chain-data/base-erc20-transfers.ts, behind its enforced scan-window budget; see docs/sql-performance.md." },
  },
  create(context) {
    const filename = String(context.filename ?? "").replaceAll("\\", "/");
    if (filename.endsWith("/server/chain-data/base-erc20-transfers.ts") || /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(filename) || filename.includes("/tests/")) return {};
    function check(node) {
      if (/\b(?:FROM|JOIN)\s+[`"]?base[`"]?\s*\.\s*[`"]?events\b/iu.test(staticText(node).replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/--[^\n]*/gu, " "))) {
        context.report({ node, messageId: "rejected" });
      }
    }
    return { Literal: check, TemplateLiteral: check, BinaryExpression: check };
  },
};
