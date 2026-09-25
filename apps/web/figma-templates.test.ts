import { afterAll, describe, expect, test } from 'bun:test'
// oxlint-disable-next-line home/no-source-reads -- This test writes temporary TSX for the one-off typecheck; it does not read product source through fs.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import * as lucide from 'lucide-react'
import mapping from './figma-components.json'
import fixture from './figma-template-props.fixture.json'

type Value = string | boolean
const definitions: Record<string, Record<string, Value | Value[]>> = fixture
const placeholders = new Set('balances onRevealSmallBalancesChange onRevealMore account onBack onHome onDashboard onSignIn onSignOut onOpenSettings onCloseSettings status range history onRangeChange rows amount onAmountChange unit pricing availableAmount onSelect onToggle asset breakdown onNavigate toastItem onActivate'.split(' '))
const root = import.meta.dir
const checking = process.env.FIGMA_TEMPLATE_TYPECHECK === '1'
const output = path.join(root, '.tmp-figma-check')
const configFile = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile)
if (configFile.error) throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'))
const options = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root).options
const inputs = mapping.components.map((entry) => {
  const source = path.join(root, entry.template)
  return { entry, source, text: ts.sys.readFile(source) ?? '' }
})
const templateImports = inputs.flatMap(({ entry, text, source }) => render(text, variants(definitions[entry.nodeId])[0]).imports.map((snippet) => {
  const item = ts.createSourceFile('import.ts', snippet, ts.ScriptTarget.Latest).statements[0]
  if (!item || !ts.isImportDeclaration(item) || !ts.isStringLiteral(item.moduleSpecifier)) throw new Error(`Invalid Code Connect import: ${snippet}`)
  return { source, snippet, item }
}))
const moduleNames = new Map<string, string>()
for (const { source, item } of templateImports) {
  const name = (item.moduleSpecifier as ts.StringLiteral).text
  const resolved = ts.resolveModuleName(name, source, options, ts.sys).resolvedModule?.resolvedFileName
  if (!resolved) throw new Error(`Cannot resolve ${name} from ${source}`)
  moduleNames.set(name, resolved)
}
const program = ts.createProgram([...new Set(moduleNames.values())], options)
const checker = program.getTypeChecker()

function importsFor(source: string): string[] {
  return templateImports.filter((item) => item.source === source).map(({ item, snippet }) => {
    const name = (item.moduleSpecifier as ts.StringLiteral).text
    const resolvedSource = program.getSourceFile(moduleNames.get(name)!)
    expect(resolvedSource, `${source}: ${name}`).toBeDefined()
    const symbol = checker.getSymbolAtLocation(resolvedSource!)
    expect(symbol, `${source}: ${name}`).toBeDefined()
    const exports = new Set(checker.getExportsOfModule(symbol!).map((entry) => entry.name))
    const bindings = item.importClause?.namedBindings
    if (bindings && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements) {
        const importedName = (binding.propertyName ?? binding.name).text
        expect(exports.has(importedName), `${source}: ${name} must export ${importedName}`).toBe(true)
      }
    }
    return snippet
  })
}

function variants(props: Record<string, Value | Value[]>): Record<string, Value>[] {
  const defaults = Object.fromEntries(Object.entries(props).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]))
  const cases = [defaults]
  for (const [key, value] of Object.entries(props)) {
    if (Array.isArray(value)) for (const choice of value.slice(1)) cases.push({ ...defaults, [key]: choice })
    if (value === 'instance') cases.push({ ...defaults, [key]: '' })
  }
  const text = Object.fromEntries(Object.entries(props).filter(([, value]) => typeof value === 'string' && value !== 'slot' && value !== 'instance').map(([key]) => [key, 'A "quote" & <tag> {value}']))
  if (Object.keys(text).length) cases.push({ ...defaults, ...text })
  if (Object.values(props).filter(Array.isArray).length > 1) {
    cases.push(Object.fromEntries(Object.entries(props).map(([key, value]) => [key, Array.isArray(value) ? value[value.length - 1] : value])))
  }
  return cases
}

function render(text: string, props: Record<string, Value>): { example: string; imports: string[] } {
  const property = (key: string) => {
    if (!Object.hasOwn(props, key)) throw new Error(`Unknown Figma property ${key}`)
    return props[key]
  }
  const instance = {
    getString: (key: string) => String(property(key)),
    getBoolean: (key: string) => Boolean(property(key)),
    getEnum: (key: string, values: Record<string, unknown>) => values[String(property(key))],
    getInstanceSwap: (key: string) => {
      const value = property(key)
      if (value !== 'instance' && !String(value).startsWith('unconnected:')) return null
      return {
        type: 'INSTANCE',
        hasCodeConnect: () => value === 'instance',
        getPropertyValue: (name: string) => name === 'icon' ? String(value).slice('unconnected:'.length) : null,
        executeTemplate: () => ({ example: key.startsWith('Icon#') ? '<span aria-hidden="true" />' : '<CurrencyMark symbol="$" />' }),
      }
    },
    getSlot: (key: string) => property(key) === 'slot' ? '<span />' : '',
    findInstance: () => null,
    findConnectedInstances: () => [],
    findText: () => null,
  }
  const figma = {
    selectedInstance: instance,
    code: (strings: TemplateStringsArray, ...values: unknown[]) => strings.reduce((result, part, index) => result + (index ? String(values[index - 1] ?? '') : '') + part, ''),
  }
  const js = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText
  const evaluated: { exports: { default?: { example: string; imports: string[] } } } = { exports: {} }
  const load = (name: string) => {
    if (name !== 'figma') throw new Error(`Unexpected template dependency: ${name}`)
    return { __esModule: true, default: figma }
  }
  new Function('require', 'module', 'exports', js)(load, evaluated, evaluated.exports)
  if (!evaluated.exports.default) throw new Error('Missing template export')
  return evaluated.exports.default
}

function declarations(source: ts.SourceFile): string[] {
  const found = new Map<string, string>()
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression && ts.isIdentifier(node.initializer.expression)) {
      const identifier = node.initializer.expression.text
      const parent = node.parent.parent
      if ((ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)) && ts.isIdentifier(parent.tagName) && ts.isIdentifier(node.name)) {
        expect(placeholders.has(identifier), `Unexpected variable ${identifier} in rendered snippet`).toBe(true)
        found.set(identifier, `declare const ${identifier}: React.ComponentProps<typeof ${parent.tagName.text}>[${JSON.stringify(node.name.text)}];`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return [...found.values()]
}

if (checking) {
  mkdirSync(output, { recursive: true })
  writeFileSync(path.join(output, 'tsconfig.json'), JSON.stringify({ extends: '../tsconfig.json', compilerOptions: { incremental: false }, include: ['./*.tsx', '../next-env.d.ts'] }))
}

let count = 0
describe('Code Connect rendered snippets', () => {
  test('property fixture matches mapped node IDs and every Icon variant resolves to lucide-react', () => {
    expect(Object.keys(definitions).sort()).toEqual(mapping.components.map(({ nodeId }) => nodeId).sort())
    const iconValues = definitions['12:27']['Icon#271:0'] as string[]
    for (const value of iconValues.filter((item) => item.startsWith('unconnected:') && item !== 'unconnected:')) {
      const name = value.slice('unconnected:'.length).replace(/(^|-)([a-z])/g, (_, _separator, letter: string) => letter.toUpperCase())
      expect(name in lucide, `Missing lucide-react export for ${value}`).toBe(true)
    }
  })
  for (const { entry, text, source } of inputs) {
    test(entry.template, () => {
      expect(text).not.toBe('')
      const imports = importsFor(source)
      const cases = variants(definitions[entry.nodeId])
      if (entry.nodeId === '12:59') cases.push({ ...cases[0], Kind: 'Unknown' })
      cases.forEach((props, index) => {
        const result = render(text, props)
        const value = props['Icon#271:0']
        const name = typeof value === 'string' && value.startsWith('unconnected:') && value !== 'unconnected:' && props['Show icon#12:15']
          ? value.slice('unconnected:'.length).replace(/(^|-)([a-z])/g, (_, _separator, letter: string) => letter.toUpperCase()) : null
        expect(result.imports).toEqual(name ? [...imports, `import { ${name} } from "lucide-react"`] : imports)
        if (entry.nodeId === '12:27') {
          if (name) expect(result.example).toContain(`<${name} />`)
          if (value === 'unconnected:' || value === '') expect(result.example).not.toMatch(/<(?:RotateCw|ChevronRight|CircleHelp|span)\b/)
          if (value === 'instance' && props['Show icon#12:15']) expect(result.example).toContain('<span aria-hidden="true" />')
        }
        expect(result.example, `${entry.template} variation ${index}`).not.toMatch(/\bundefined\b/)
        if (entry.nodeId === '12:27') {
          expect(result.example.includes(' disabled')).toBe(props.state === 'disabled')
          expect(result.example.includes(' loading')).toBe(props.state === 'loading')
          if (props.size === 'touch') expect(result.example).not.toBe(render(text, { ...props, size: 'lg' }).example)
        }
        if (entry.nodeId === '12:59' && props.Kind === 'Unknown') expect(result.example).toContain('currency={""}')
        if (entry.nodeId === '269:5270') expect(result.example).toMatch(/<Card variant="[^"]+"><CardContent inset="[^"]+">/)
        const contents = `${result.imports.join('\n')}\nconst example = (<>${result.example}</>);\n`
        const ast = ts.createSourceFile('snippet.tsx', contents, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
        const errors = (ast as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics
        expect(errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')), `${entry.template} variation ${index}: ${result.example}`).toEqual([])
        const declared = declarations(ast)
        if (checking) {
          writeFileSync(path.join(output, `${entry.template.replaceAll('/', '-')}-${index}.tsx`), `${result.imports.join('\n')}\n${declared.join('\n')}\nconst example = (<>${result.example}</>);\n`)
        }
        count++
      })
    })
  }
})

afterAll(() => { if (checking) console.log(`Generated ${count} Code Connect typecheck renders in ${output}`) })
