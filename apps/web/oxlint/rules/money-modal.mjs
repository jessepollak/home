import path from "node:path";
import { sheetHostExceptions } from "../policy/sheet-hosts.mjs";

const api = "Use the shared money-modal API in docs/design-system/product-pieces/money-modal.md.";
const exceptions = "For a non-money drawer exception, add a reviewed named import with owner and reason to oxlint/policy/sheet-hosts.mjs; do not disable this rule.";
const packages = [
  "vaul", "react-modal", "@radix-ui/react-dialog", "@radix-ui/react-alert-dialog",
  "@radix-ui/react-portal", "@headlessui/react", "@base-ui/react/drawer",
  "@base-ui/react/dialog", "@base-ui/react/alert-dialog",
];

function sourceValue(node) {
  if (node?.type === "Literal" || node?.type === "StringLiteral") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0]?.value.cooked;
  return undefined;
}

function filenameWithinWeb(filename) {
  const normalized = String(filename ?? "").replaceAll("\\", "/");
  const webRoot = normalized.lastIndexOf("/apps/web/");
  const segments = (webRoot < 0 ? normalized : normalized.slice(webRoot + "/apps/web/".length)).split("/");
  const layer = segments.findIndex((segment) => ["app", "client", "components", "stories"].includes(segment));
  return segments.slice(layer < 0 ? 0 : layer).join("/");
}

function resolvedSource(value, filename) {
  if (typeof value !== "string") return null;
  if (value.startsWith("@/")) return path.posix.normalize(value.slice(2));
  if (!value.startsWith(".")) return null;
  return path.posix.normalize(path.posix.join(path.posix.dirname(filenameWithinWeb(filename)), value));
}

function withoutExtension(value) {
  return value.replace(/\.(?:[cm]?[jt]sx?)$/u, "");
}

function primitive(value, filename) {
  if (typeof value !== "string") return null;
  if (packages.some((pkg) => value === pkg || value.startsWith(`${pkg}/`))) return value;
  const target = withoutExtension(resolvedSource(value, filename) ?? "").replace(/\/index$/u, "");
  return target === "components/ui/drawer" ? target : null;
}

function internalMoneyModal(value, filename) {
  const target = withoutExtension(resolvedSource(value, filename) ?? "");
  return target.startsWith("client/money-modal/")
    && !["client/money-modal/index", "client/money-modal/deferred-sheet"].includes(target);
}

function sourceVisitors(check) {
  return {
    ImportDeclaration(node) { check(node.source, node); },
    ExportNamedDeclaration(node) { if (node.source) check(node.source, node); },
    ExportAllDeclaration(node) { check(node.source, node); },
    ImportExpression(node) { check(node.source, node); },
    CallExpression(node) {
      if (node.callee.type === "Identifier" && node.callee.name === "require") check(node.arguments[0], node);
    },
  };
}

function namedImportIsAllowed(node, target, filename) {
  if (target !== "components/ui/drawer" || node.type !== "ImportDeclaration") return false;
  const policy = sheetHostExceptions.find((entry) => entry.file === filenameWithinWeb(filename));
  return Boolean(policy && node.specifiers.length > 0 && node.specifiers.every((specifier) =>
    specifier.type === "ImportSpecifier" && policy.imports.includes(specifier.imported.name ?? specifier.imported.value)));
}

function reactDom(value) {
  return value === "react-dom" || value === "react-dom/client";
}

function memberName(node) {
  if (!node.computed && node.property.type === "Identifier") return node.property.name;
  return node.computed ? sourceValue(node.property) : undefined;
}

function reactDomValue(node, bindings) {
  if (!node) return false;
  if (node.type === "Identifier") return bindings.has(node.name);
  if (node.type === "AwaitExpression") return reactDomValue(node.argument, bindings);
  if (node.type === "ImportExpression") return reactDom(sourceValue(node.source));
  if (node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "require") {
    return reactDom(sourceValue(node.arguments[0]));
  }
  if (node.type === "MemberExpression" && memberName(node) === "default") return reactDomValue(node.object, bindings);
  return false;
}

function patternKey(property) {
  if (property.type !== "Property") return undefined;
  if (!property.computed && property.key.type === "Identifier") return property.key.name;
  return sourceValue(property.key);
}

function bindReactDomPattern(pattern, bindings, context) {
  if (pattern?.type === "AssignmentPattern") return bindReactDomPattern(pattern.left, bindings, context);
  if (pattern?.type === "Identifier") return void bindings.add(pattern.name);
  if (pattern?.type !== "ObjectPattern") return;
  for (const property of pattern.properties) {
    if (property.type === "RestElement") bindReactDomPattern(property.argument, bindings, context);
    else if (patternKey(property) === "createPortal") context.report({ node: property, messageId: "portal" });
    else if (patternKey(property) === "default") bindReactDomPattern(property.value, bindings, context);
  }
}

export const noSheetPrimitives = {
  meta: {
    type: "problem", schema: [],
    messages: {
      primitive: `Do not import sheet primitives or overlay packages here. ${api} ${exceptions}`,
      portal: `Do not create a separate sheet portal. ${api}`,
      host: `Do not create a custom dialog host here. ${api}`,
    },
  },
  create(context) {
    const reactDomBindings = new Set();
    const visitors = sourceVisitors((source, node) => {
      const target = primitive(sourceValue(source), context.filename);
      if (target && !namedImportIsAllowed(node, target, context.filename)) {
        context.report({ node: source, messageId: "primitive" });
      }
    });
    return {
      ...visitors,
      Program(node) {
        for (const statement of node.body) {
          if (statement.type !== "ImportDeclaration" || !reactDom(sourceValue(statement.source))) continue;
          for (const specifier of statement.specifiers) {
            if (["ImportNamespaceSpecifier", "ImportDefaultSpecifier"].includes(specifier.type)
              || (specifier.type === "ImportSpecifier" && (specifier.imported.name ?? specifier.imported.value) === "default")) {
              reactDomBindings.add(specifier.local.name);
            }
          }
        }
      },
      ImportDeclaration(node) {
        visitors.ImportDeclaration(node);
        if (!reactDom(sourceValue(node.source))) return;
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportSpecifier" && (specifier.imported.name ?? specifier.imported.value) === "createPortal") {
            context.report({ node: specifier, messageId: "portal" });
          }
        }
      },
      VariableDeclarator(node) {
        if (!reactDomValue(node.init, reactDomBindings)) return;
        bindReactDomPattern(node.id, reactDomBindings, context);
      },
      AssignmentExpression(node) {
        if (reactDomValue(node.right, reactDomBindings)) bindReactDomPattern(node.left, reactDomBindings, context);
      },
      MemberExpression(node) {
        if (reactDomValue(node.object, reactDomBindings) && memberName(node) === "createPortal") {
          context.report({ node, messageId: "portal" });
        }
      },
      CallExpression(node) {
        visitors.CallExpression(node);
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || memberName(callee) !== "then" || !reactDomValue(callee.object, reactDomBindings)) return;
        const callback = node.arguments[0];
        if (callback && ["ArrowFunctionExpression", "FunctionExpression"].includes(callback.type) && callback.params[0]) {
          bindReactDomPattern(callback.params[0], reactDomBindings, context);
        }
      },
      JSXOpeningElement(node) {
        if (node.name.type === "JSXIdentifier" && node.name.name === "dialog") {
          context.report({ node: node.name, messageId: "host" });
        }
        for (const attribute of node.attributes) {
          if (attribute.type !== "JSXAttribute" || attribute.name.type !== "JSXIdentifier") continue;
          if (attribute.name.name === "aria-modal" || (attribute.name.name === "role"
            && ["dialog", "alertdialog"].includes(sourceValue(attribute.value?.type === "JSXExpressionContainer"
              ? attribute.value.expression : attribute.value)))) {
            context.report({ node: attribute, messageId: "host" });
          }
        }
      },
    };
  },
};

export const noSheetPrimitiveReexports = {
  meta: {
    type: "problem", schema: [],
    messages: { rejected: `Do not re-export sheet primitives or overlay packages. ${api}` },
  },
  create(context) {
    const importedBindings = new Set();
    const localExports = [];
    return {
      ImportDeclaration(node) {
        if (primitive(sourceValue(node.source), context.filename)) {
          for (const specifier of node.specifiers) importedBindings.add(specifier.local.name);
        }
      },
      ExportNamedDeclaration(node) {
        if (node.source) {
          if (primitive(sourceValue(node.source), context.filename)) context.report({ node: node.source, messageId: "rejected" });
        } else if (node.specifiers) {
          for (const specifier of node.specifiers) localExports.push({ name: specifier.local.name ?? specifier.local.value, node: specifier });
        }
      },
      ExportAllDeclaration(node) {
        if (primitive(sourceValue(node.source), context.filename)) context.report({ node: node.source, messageId: "rejected" });
      },
      ExportDefaultDeclaration(node) {
        if (node.declaration.type === "Identifier") localExports.push({ name: node.declaration.name, node: node.declaration });
      },
      "Program:exit"() {
        for (const { name, node } of localExports) {
          if (importedBindings.has(name)) context.report({ node, messageId: "rejected" });
        }
      },
    };
  },
};

export const moneyModalPublicApi = {
  meta: {
    type: "problem", schema: [],
    messages: { rejected: `Import money-modal through its barrel or deferred-sheet entry point. ${api}` },
  },
  create(context) {
    return sourceVisitors((source) => {
      if (internalMoneyModal(sourceValue(source), context.filename)) context.report({ node: source, messageId: "rejected" });
    });
  },
};

const hostName = /^(?:MoneyModal|AppDrawer|MoneyConfirmFooter|MoneySheet|MoneyDrawer|MoneyDialog)/u;

export const noAlternateMoneyModal = {
  meta: {
    type: "problem", schema: [],
    messages: { rejected: `Do not declare an alternate money-modal host. ${api}` },
  },
  create(context) {
    function check(id) {
      if (id?.type === "Identifier" && hostName.test(id.name)) context.report({ node: id, messageId: "rejected" });
    }
    return {
      FunctionDeclaration(node) { check(node.id); },
      ClassDeclaration(node) { check(node.id); },
      VariableDeclarator(node) { check(node.id); },
    };
  },
};

const spinClass = /(?:^|\s)(?:[^\s:]+:)*animate-spin(?=\s|$)/u;
const transientProgress = /^(?:Preparing|Getting|Waiting for|Loading|Verifying)\b.*(?:…|\.\.\.)$/u;

function jsxName(node) {
  return node?.type === "JSXIdentifier" ? node.name : null;
}

function jsxAttribute(opening, name) {
  return opening.attributes.find((attribute) => attribute.type === "JSXAttribute" && jsxName(attribute.name) === name);
}

function activeLoadingButton(opening) {
  if (jsxName(opening.name) !== "Button") return false;
  const loading = jsxAttribute(opening, "loading");
  return Boolean(loading && (!loading.value || loading.value.expression?.value !== false));
}

function allowedLoadingCopy(node) {
  let current = node;
  while (current.parent) {
    const parent = current.parent;
    if (parent.type === "JSXAttribute") {
      const opening = parent.parent;
      const name = jsxName(opening?.name);
      const label = jsxName(parent.name);
      return label === "primaryLabel" && ["MoneyModalFooter", "MoneyConfirmFooter"].includes(name);
    }
    if (parent.type === "JSXElement" && activeLoadingButton(parent.openingElement)) return true;
    current = parent;
  }
  return false;
}

export const noUnownedLoading = {
  meta: {
    type: "problem", schema: [],
    messages: {
      icon: "Use an owned loading control instead of importing LoaderCircle in product code.",
      spin: "Use Button loading or an owned loading component instead of animate-spin here.",
    },
  },
  create(context) {
    const filename = filenameWithinWeb(context.filename);
    if (filename.startsWith("components/") || filename.startsWith("stories/")
      || /(?:^|\/)(?:tests|testing|explorations)\//u.test(filename)
      || /\.(?:test|stories)\.[cm]?[jt]sx?$/u.test(filename)) return {};
    function checkSpin(node, value) {
      if (typeof value === "string" && spinClass.test(value)) context.report({ node, messageId: "spin" });
    }
    return {
      ImportDeclaration(node) {
        if (sourceValue(node.source) !== "lucide-react") return;
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportSpecifier" && (specifier.imported.name ?? specifier.imported.value) === "LoaderCircle") {
            context.report({ node: specifier, messageId: "icon" });
          }
        }
      },
      Literal(node) { checkSpin(node, node.value); },
      StringLiteral(node) { checkSpin(node, node.value); },
      TemplateElement(node) { checkSpin(node, node.value.raw); },
    };
  },
};

const dismissLabel = /^(?:Cancel|Close|Back|Not now|Maybe later|Dismiss|No thanks|Never mind|Go back)$/iu;

function jsxPropValue(opening, name) {
  const value = jsxAttribute(opening, name)?.value;
  return value?.type === "JSXExpressionContainer" ? value.expression : value;
}

function literalString(node) {
  return ["Literal", "StringLiteral"].includes(node?.type) && typeof node.value === "string" ? node.value : undefined;
}

function buttonVariantCall(node) {
  if (!node || typeof node !== "object") return null;
  if (node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "buttonVariants") return node;
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent") continue;
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child?.type) {
        const call = buttonVariantCall(child);
        if (call) return call;
      }
    }
  }
  return null;
}

function buttonText(node) {
  if (node.type === "JSXText") return node.value;
  if (node.type === "JSXExpressionContainer") {
    const expression = node.expression;
    if (expression.type === "JSXEmptyExpression") return "";
    const value = sourceValue(expression);
    if (value !== undefined) return typeof value === "string" || typeof value === "number" ? String(value) : "";
    if (["JSXElement", "JSXFragment"].includes(expression.type)) return buttonText(expression);
    return null;
  }
  if (node.children) {
    const parts = node.children.map(buttonText);
    return parts.includes(null) ? null : parts.join("");
  }
  return "";
}

function actionButton(node) {
  let button = node;
  let opening = node.openingElement;
  const name = jsxName(opening.name);
  if (name === "DrawerClose") {
    button = jsxPropValue(opening, "render");
    if (button?.type !== "JSXElement" || jsxName(button.openingElement.name) !== "Button") return null;
    opening = button.openingElement;
  } else if (!["Button", "Link", "a"].includes(name)) return null;

  let variant = jsxPropValue(opening, "variant");
  let size = jsxPropValue(opening, "size");
  if (["Link", "a"].includes(name)) {
    const call = opening.attributes.map(buttonVariantCall).find(Boolean);
    if (!call) return null;
    const options = call.arguments[0];
    if (options && options.type !== "ObjectExpression") return null;
    variant = options?.properties.find((property) => patternKey(property) === "variant")?.value;
    size = options?.properties.find((property) => patternKey(property) === "size")?.value;
  }
  const variantName = variant === undefined ? "default" : literalString(variant);
  if (!variantName || variantName === "link" || literalString(size)?.startsWith("icon")) return null;
  const outerText = buttonText(node);
  const text = name === "DrawerClose" && outerText?.trim() === "" ? buttonText(button) : outerText;
  if (text !== null && !text.trim()) return null;
  const dismiss = text !== null && dismissLabel.test(text.replace(/\s+/gu, " ").trim());
  return {
    node,
    dismiss: dismiss || ["ghost", "outline", "secondary"].includes(variantName),
    affirmative: !dismiss && ["default", "destructive"].includes(variantName),
  };
}

export const affirmativeActionFirst = {
  meta: {
    type: "problem", schema: [],
    messages: { rejected: "Put the affirmative action first in an action group; dismiss, cancel or back follows it. See docs/design-system/spec.md#do--dont." },
  },
  create(context) {
    const reported = new Set();
    function checkChildren(children, affirmativeAfter) {
      for (let index = children.length - 1; index >= 0; index -= 1) {
        affirmativeAfter = checkSibling(children[index], affirmativeAfter);
      }
      return affirmativeAfter;
    }
    function checkSibling(node, affirmativeAfter) {
      if (node.type === "JSXFragment") return checkChildren(node.children, affirmativeAfter);
      if (node.type === "JSXExpressionContainer") return checkSibling(node.expression, affirmativeAfter);
      if (node.type === "ConditionalExpression") {
        const consequent = checkSibling(node.consequent, affirmativeAfter);
        const alternate = checkSibling(node.alternate, affirmativeAfter);
        return consequent || alternate;
      }
      if (node.type === "LogicalExpression") return checkSibling(node.left, checkSibling(node.right, affirmativeAfter));
      if (node.type !== "JSXElement") return affirmativeAfter;
      const button = actionButton(node);
      if (button?.dismiss && affirmativeAfter && !reported.has(node)) {
        reported.add(node);
        context.report({ node, messageId: "rejected" });
      }
      return affirmativeAfter || Boolean(button?.affirmative);
    }
    function slotAttribute(opening, name) {
      const attribute = jsxAttribute(opening, name);
      if (!attribute || opening.attributes.slice(opening.attributes.indexOf(attribute) + 1).some((item) => item.type === "JSXSpreadAttribute")) return null;
      return attribute;
    }
    function slotAction(node) {
      if (node?.type === "JSXExpressionContainer") return slotAction(node.expression);
      if (node?.type === "JSXFragment") {
        const children = node.children.filter((child) => child.type !== "JSXText"
          && !(child.type === "JSXExpressionContainer" && child.expression.type === "JSXEmptyExpression"));
        return children.length === 1 ? slotAction(children[0]) : null;
      }
      return node?.type === "JSXElement" ? actionButton(node) : null;
    }
    function check(node) {
      checkChildren(node.children, false);
      if (node.type !== "JSXElement" || jsxName(node.openingElement.name) !== "MoneyModalFooter") return;
      const primary = slotAttribute(node.openingElement, "primary");
      const secondary = slotAttribute(node.openingElement, "secondary");
      if (!primary || !secondary) return;
      const first = slotAction(primary.value);
      const second = slotAction(secondary.value);
      if (first?.dismiss && second?.affirmative && !reported.has(first.node)) {
        reported.add(first.node);
        context.report({ node: first.node, messageId: "rejected" });
      }
    }
    return { JSXElement: check, JSXFragment: check };
  },
};

export const noTransientMoneyCopy = {
  meta: {
    type: "problem", schema: [],
    messages: { rejected: "Keep the current money step and show loading on its primary footer button, not in progress-only copy." },
  },
  create(context) {
    if (!filenameWithinWeb(context.filename).startsWith("client/")) return {};
    let hasMoneyStep = false;
    function check(node, value) {
      if (hasMoneyStep && typeof value === "string" && transientProgress.test(value.trim()) && !allowedLoadingCopy(node)) {
        context.report({ node, messageId: "rejected" });
      }
    }
    return {
      Program(node) {
        hasMoneyStep = node.body.some((statement) => statement.type === "ImportDeclaration"
          && withoutExtension(resolvedSource(sourceValue(statement.source), context.filename) ?? "") === "client/money-modal"
          && statement.specifiers.some((specifier) => specifier.type === "ImportSpecifier"
            && ["MoneyModalStep", "MoneyModalFooter", "MoneyConfirmFooter"].includes(specifier.imported.name ?? specifier.imported.value)));
      },
      JSXText(node) { check(node, node.value.replace(/\s+/gu, " ")); },
      Literal(node) { if (typeof node.value === "string") check(node, node.value); },
      StringLiteral(node) { if (typeof node.value === "string") check(node, node.value); },
      TemplateLiteral(node) { if (node.expressions.length === 0) check(node, node.quasis[0]?.value.cooked); },
    };
  },
};
