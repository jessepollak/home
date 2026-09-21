const amountName = /(?:amount|balance|total|quantity|value|assets|shares|usd|fiat|atomic)(?:BaseUnits|Units|Wei|Wad|Atomic|Usd|Fiat)?$/iu;

function sourceValue(node) {
  if (node?.type === "Literal" || node?.type === "StringLiteral" || node?.type === "NumericLiteral") {
    return node.value;
  }
  return undefined;
}

function unwrapExpression(node) {
  while (node && [
    "ParenthesizedExpression",
    "ChainExpression",
    "TSAsExpression",
    "TSTypeAssertion",
    "TSNonNullExpression",
    "TSSatisfiesExpression",
  ].includes(node.type)) node = node.expression;
  return node;
}

function semanticName(node) {
  node = unwrapExpression(node);
  if (node?.type === "Identifier") return node.name;
  if (node?.type === "MemberExpression") {
    if (!node.computed && node.property.type === "Identifier") return node.property.name;
    if (node.computed && typeof sourceValue(node.property) === "string") return sourceValue(node.property);
  }
  return null;
}

function amountExpression(node) {
  node = unwrapExpression(node);
  const name = semanticName(node);
  if (name && amountName.test(name)) return true;
  if (node?.type !== "CallExpression") return false;
  const calleeName = semanticName(node.callee);
  if (calleeName === "Number" || calleeName === "parseFloat") {
    return Boolean(node.arguments[0] && amountExpression(node.arguments[0]));
  }
  return false;
}

function zeroFallback(node) {
  const value = sourceValue(unwrapExpression(node));
  return value === 0 || value === 0n || value === "0";
}

export const noAmountFallback = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      rejected: "Do not default a money amount to zero; propagate the null/unavailable state or fail closed.",
    },
  },
  create(context) {
    return {
      LogicalExpression(node) {
        if (!["??", "||"].includes(node.operator) || !zeroFallback(node.right)
          || !amountExpression(node.left)) return;
        context.report({ node, messageId: "rejected" });
      },
    };
  },
};
