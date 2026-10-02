import ts from "typescript";

export function isDomTestSource(source, file = "unit.test.ts") {
  const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false);
  let usesDom = false;
  function visit(node) {
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) {
      usesDom ||= domModule(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      usesDom ||= domModule(node.arguments[0].text);
    }
    if (!usesDom) ts.forEachChild(node, visit);
  }
  visit(syntax);
  return usesDom;
}

function domModule(name) {
  return name.includes("dom-test-harness") || name === "@testing-library/react"
    || name === "@happy-dom/global-registrator" || name.includes("tests/helpers/dom");
}
