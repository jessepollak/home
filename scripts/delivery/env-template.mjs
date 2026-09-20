// Operator-configured process.env reads must be declared in .env.example.
// Platform/runtime-injected and test-only variables are allowlisted explicitly;
// the allowlist fails stale so removed reads force its cleanup.

const DOT_ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*=/;
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

// Tokenize only the JavaScript/TypeScript shapes needed by this gate. Comments
// are discarded and quoted strings remain single tokens, which prevents source
// examples from becoming reads while preserving process.env["NAME"] access.
function tokenize(source) {
  const tokens = [];
  for (let i = 0; i < source.length;) {
    const ch = source[i];
    const next = source[i + 1];
    if (/\s/.test(ch)) {
      i += 1;
    } else if (ch === "/" && next === "/") {
      i += 2;
      while (i < source.length && source[i] !== "\n") i += 1;
    } else if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
    } else if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      let value = "";
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\" && i + 1 < source.length) {
          value += source[i + 1];
          i += 2;
        } else {
          value += source[i];
          i += 1;
        }
      }
      i += i < source.length ? 1 : 0;
      tokens.push({ type: quote === "`" ? "template" : "string", value });
      if (quote === "`") {
        for (const expression of value.matchAll(/\$\{([\s\S]*?)\}/g)) {
          tokens.push(...tokenize(expression[1]));
        }
      }
    } else if (/[A-Za-z_$]/.test(ch)) {
      let value = ch;
      i += 1;
      while (i < source.length && /[A-Za-z0-9_$]/.test(source[i])) {
        value += source[i];
        i += 1;
      }
      tokens.push({ type: "identifier", value });
    } else {
      tokens.push({ type: "punctuation", value: ch });
      i += 1;
    }
  }
  return tokens;
}

function matchingPairs(tokens, open, close) {
  const pairs = new Map();
  const stack = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].value === open) stack.push(i);
    if (tokens[i].value === close && stack.length) pairs.set(stack.pop(), i);
  }
  return pairs;
}

function aliasBindingBefore(tokens, equalsIndex) {
  const immediate = tokens[equalsIndex - 1];
  if (immediate?.type === "identifier") return { name: immediate.value, index: equalsIndex - 1 };

  // Type-annotated bindings end in a type token rather than the binding name:
  // env: Readonly<Record<string, string | undefined>> = process.env.
  for (let i = equalsIndex - 1; i >= 1; i -= 1) {
    if (tokens[i].value === ":" && tokens[i - 1].type === "identifier") {
      return { name: tokens[i - 1].value, index: i - 1 };
    }
    if (["=", ";", "{"].includes(tokens[i].value)) break;
  }
  return null;
}

function aliasAssignment(tokens, processIndex) {
  if (tokens[processIndex - 1]?.value === "=") {
    const binding = aliasBindingBefore(tokens, processIndex - 1);
    return binding ? { ...binding, fallback: false } : null;
  }

  const nullishFallback = tokens[processIndex - 2]?.value === "?" && tokens[processIndex - 1]?.value === "?";
  const orFallback = tokens[processIndex - 2]?.value === "|" && tokens[processIndex - 1]?.value === "|";
  if (!nullishFallback && !orFallback) return null;

  for (let i = processIndex - 3; i >= 1; i -= 1) {
    if ([";", "{"].includes(tokens[i].value)) break;
    if (tokens[i].value !== "=") continue;
    const binding = aliasBindingBefore(tokens, i);
    if (!binding) continue;
    const variableDeclaration = tokens
      .slice(Math.max(0, binding.index - 4), binding.index)
      .some((token) => ["const", "let", "var"].includes(token.value));
    if (variableDeclaration) return { ...binding, fallback: true };
  }
  return null;
}

function functionScopes(tokens, parenPairs, bracePairs) {
  const scopes = [];
  for (const [open, close] of parenPairs) {
    const before = tokens.slice(Math.max(0, open - 6), open);
    const isFunction = before.some((token) => token.value === "function");
    let body = close + 1;
    while (body < tokens.length && tokens[body].value !== "{" && tokens[body].value !== ";") body += 1;
    const isArrow = tokens[close + 1]?.value === "=" && tokens[close + 2]?.value === ">";
    const isMethod = tokens[open - 1]?.type === "identifier" && tokens[body]?.value === "{";
    if ((!isFunction && !isArrow && !isMethod) || tokens[body]?.value !== "{") continue;

    const bindingEntries = [];
    let atParameterStart = true;
    let nestedParens = 0;
    let nestedBraces = 0;
    let nestedBrackets = 0;
    let nestedAngles = 0;
    for (let i = open + 1; i < close; i += 1) {
      const value = tokens[i].value;
      const atTopLevel = nestedParens === 0 && nestedBraces === 0 && nestedBrackets === 0 && nestedAngles === 0;
      if (atTopLevel && atParameterStart && tokens[i].type === "identifier") {
        bindingEntries.push({ name: tokens[i].value, index: i });
        atParameterStart = false;
      }
      if (atTopLevel && value === ",") {
        atParameterStart = true;
        continue;
      }
      if (value === "(") nestedParens += 1;
      else if (value === ")" && nestedParens > 0) nestedParens -= 1;
      else if (value === "{") nestedBraces += 1;
      else if (value === "}" && nestedBraces > 0) nestedBraces -= 1;
      else if (value === "[") nestedBrackets += 1;
      else if (value === "]" && nestedBrackets > 0) nestedBrackets -= 1;
      else if (value === "<") nestedAngles += 1;
      else if (value === ">" && nestedAngles > 0) nestedAngles -= 1;
    }
    scopes.push({
      parameters: [open, close],
      body: [body, bracePairs.get(body) ?? tokens.length],
      bindingEntries,
      firstBinding: bindingEntries[0] ?? null,
      functionName: isFunction && tokens[open - 1]?.type === "identifier" ? tokens[open - 1].value : null,
    });
  }
  return scopes;
}

function containingBlockRange(tokens, tokenIndex, bracePairs) {
  let containingOpen = -1;
  let containingClose = tokens.length;
  for (const [open, close] of bracePairs) {
    if (open < tokenIndex && close > tokenIndex && open > containingOpen) {
      containingOpen = open;
      containingClose = close;
    }
  }
  return [containingOpen < 0 ? 0 : containingOpen, containingClose];
}

function variableBindings(tokens, bracePairs, functionScopeList) {
  const bindings = [];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (!["const", "let", "var"].includes(tokens[i].value) || tokens[i + 1].type !== "identifier") continue;
    let range = containingBlockRange(tokens, i + 1, bracePairs);
    if (tokens[i].value === "var") {
      const functionScope = functionScopeList
        .filter((scope) => scope.body[0] < i && scope.body[1] > i)
        .sort((a, b) => b.body[0] - a.body[0])[0];
      if (functionScope) range = functionScope.body;
    }
    bindings.push({ name: tokens[i + 1].value, index: i + 1, range });
  }
  return bindings;
}

function referenceUsesAlias(alias, referenceIndex, variableBindingList, functionScopeList) {
  const candidates = [
    ...variableBindingList,
    ...functionScopeList.flatMap((scope) =>
      scope.bindingEntries.map((binding) => ({ ...binding, range: scope.body })),
    ),
  ]
    .filter(
      (binding) =>
        binding.name === alias.name &&
        binding.range[0] <= referenceIndex &&
        binding.range[1] > referenceIndex,
    )
    .sort((a, b) => {
      const spanDifference = (a.range[1] - a.range[0]) - (b.range[1] - b.range[0]);
      return spanDifference || b.range[0] - a.range[0];
    });
  return candidates[0]?.index === alias.bindingIndex;
}

function aliasRange(tokens, processIndex, functionScopeList, bracePairs) {
  // A direct process.env default in a function parameter binds only in that
  // function body, not in unrelated functions that happen to call a record env.
  const parameterScope = functionScopeList.find(
    (scope) => scope.parameters[0] < processIndex && scope.parameters[1] > processIndex,
  );
  if (parameterScope) return parameterScope.body;

  // A local const/let/var alias is visible through its containing block. The
  // caller separately handles the one direct named-helper edge needed for a
  // fallback alias; object and destructured propagation remain excluded.
  const [, containingClose] = containingBlockRange(tokens, processIndex, bracePairs);
  return [processIndex + 3, containingClose];
}

function propertyName(tokens, objectIndex) {
  if (tokens[objectIndex + 1]?.value === "." && tokens[objectIndex + 2]?.type === "identifier") {
    return ENV_NAME.test(tokens[objectIndex + 2].value) ? tokens[objectIndex + 2].value : null;
  }
  if (
    tokens[objectIndex + 1]?.value === "[" &&
    tokens[objectIndex + 2]?.type === "string" &&
    tokens[objectIndex + 3]?.value === "]" &&
    ENV_NAME.test(tokens[objectIndex + 2].value)
  ) {
    return tokens[objectIndex + 2].value;
  }
  return null;
}

export function parseEnvTemplateNames(content) {
  const names = new Set();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(DOT_ENV_NAME);
    if (match) names.add(trimmed.slice(0, trimmed.indexOf("=")).trim());
  }
  return names;
}

export function readDirectEnvNames(files) {
  const names = new Map();
  for (const file of files) {
    const tokens = tokenize(file.content);
    const parenPairs = matchingPairs(tokens, "(", ")");
    const bracePairs = matchingPairs(tokens, "{", "}");
    const functionScopeList = functionScopes(tokens, parenPairs, bracePairs);
    const variableBindingList = variableBindings(tokens, bracePairs, functionScopeList);
    const aliases = [];

    for (let i = 0; i < tokens.length - 2; i += 1) {
      if (tokens[i].value !== "process" || tokens[i + 1].value !== "." || tokens[i + 2].value !== "env") continue;
      const directName = propertyName(tokens, i + 2);
      if (directName) note(names, directName, file.path);

      const wholeEnvironment = tokens[i + 3]?.value !== "." && tokens[i + 3]?.value !== "[";
      const assignment = wholeEnvironment ? aliasAssignment(tokens, i) : null;
      if (assignment) {
        aliases.push({
          name: assignment.name,
          bindingIndex: assignment.index,
          fallback: assignment.fallback,
          range: aliasRange(tokens, i, functionScopeList, bracePairs),
        });
      }
    }

    // A named helper called directly with a fallback alias inherits that alias
    // for its corresponding first parameter. This intentionally stops at one
    // direct call edge and does not infer object/destructured propagation.
    for (const alias of aliases.filter((candidate) => candidate.fallback)) {
      for (let i = alias.range[0]; i < alias.range[1] - 3; i += 1) {
        const target = functionScopeList.find((scope) => scope.functionName === tokens[i].value);
        if (!target?.firstBinding) continue;
        if (tokens[i + 1]?.value !== "(" || tokens[i + 2]?.value !== alias.name || tokens[i + 3]?.value !== ")") continue;
        if (!referenceUsesAlias(alias, i + 2, variableBindingList, functionScopeList)) continue;
        aliases.push({
          name: target.firstBinding.name,
          bindingIndex: target.firstBinding.index,
          fallback: true,
          range: target.body,
        });
      }
    }

    for (const alias of aliases) {
      for (let i = alias.range[0]; i < alias.range[1]; i += 1) {
        if (tokens[i].value !== alias.name) continue;
        if (!referenceUsesAlias(alias, i, variableBindingList, functionScopeList)) continue;
        const name = propertyName(tokens, i);
        if (name) note(names, name, file.path);
      }
    }
  }
  return names;
}

function note(map, name, file) {
  if (!map.has(name)) map.set(name, new Set());
  map.get(name).add(file);
}

// declared: names declared in .env.example; read: Map name -> reading files;
// allowlist: documented platform/test-only names. Returns sorted violations.
export function evaluateEnvTemplate({ declared, read, allowlist = [] }) {
  const allowed = new Set(allowlist);
  const undeclared = [...read.keys()]
    .filter((name) => !declared.has(name) && !allowed.has(name))
    .sort();
  const staleAllowlist = allowlist.filter((name) => !read.has(name)).sort();
  return { undeclared, staleAllowlist };
}
