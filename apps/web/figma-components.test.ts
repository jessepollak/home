import { describe, expect, test } from 'bun:test'
import mapping, { componentFiles } from './tests/helpers/figma-mapping'
import config from './figma.config.json'
import inventory from '../../docs/design-explorations/figma-mapping.json'

const root = import.meta.dir
const templates = mapping.components.map(({ template }) => template)
const listedNodeIds = [...mapping.components, ...mapping.frames, ...mapping.notMapped].map(({ nodeId }) => nodeId)
const result = Bun.spawnSync(['bunx', 'figma', 'connect', 'parse', '--exit-on-unreadable-files', '--outFile', '/dev/stdout'], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
if (result.exitCode !== 0) throw new Error(`Code Connect parse failed: ${result.stderr.toString()}`)
const docs = JSON.parse(result.stdout.toString()) as Array<{ figmaNode: string; source: string; component: string; _codeConnectFilePath: string }>

// Component modules (e.g. @number-flow/react) register browser globals on
// import; importing them here would leak into later test files, so a child
// Bun process imports every source and reports its export names.
const sources = [...new Set([...mapping.components, ...mapping.notInFigma].map(({ source }) => source))]
const exportsScript = `const out = {}; for (const source of ${JSON.stringify(sources)}) out[source] = Object.keys(await import(process.cwd() + '/' + source)); process.stdout.write(JSON.stringify(out))`
const exportsResult = Bun.spawnSync([process.execPath, '--preload', './tests/server-only-preload.ts', '--eval', exportsScript], { cwd: root, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, NODE_ENV: 'test' } })
if (exportsResult.exitCode !== 0) throw new Error(`Importing mapped sources failed: ${exportsResult.stderr.toString()}`)
const exportNames = JSON.parse(exportsResult.stdout.toString()) as Record<string, string[]>

function included(path: string): boolean {
  return config.codeConnect.include.some((glob) => new Bun.Glob(glob).match(path))
}

describe('Figma Code Connect mapping', () => {
  test('uses the published Home library and distinct node identifiers', () => {
    expect(mapping.fileKey).toBe('ixgttt6IurKynsvMJpLYDC')
    expect(mapping.fileUrl).toBe(`https://www.figma.com/design/${mapping.fileKey}/Home`)
    expect(new Set(listedNodeIds).size).toBe(listedNodeIds.length)
    for (const nodeId of listedNodeIds) expect(nodeId).toMatch(/^\d+:\d+$/)
  })

  test('each mapped component exports its owner and matches a parsed template', () => {
    expect(mapping.components.length).toBeGreaterThan(0)
    expect(new Set(mapping.components.map(({ figmaName }) => figmaName)).size).toBe(componentFiles.length)
    expect(componentFiles.sort()).toEqual(mapping.components.map(({ figmaName }) => `${figmaName}.json`).sort())
    expect(new Set(templates).size).toBe(templates.length)
    expect(docs).toHaveLength(mapping.components.length)
    expect(new Set(docs.map(({ _codeConnectFilePath }) => _codeConnectFilePath)).size).toBe(docs.length)
    const parsedByTemplate = new Map(docs.map((doc) => [doc._codeConnectFilePath, doc]))
    expect([...parsedByTemplate.keys()].sort()).toEqual(templates.map((template) => `${root}/${template}`).sort())
    for (const entry of mapping.components) {
      expect(exportNames[entry.source], `${entry.source} exports ${entry.component}`).toContain(entry.component)
      expect(parsedByTemplate.get(`${root}/${entry.template}`)).toMatchObject({
        figmaNode: `${mapping.fileUrl}?node-id=${entry.nodeId.replace(':', '-')}`,
        source: `apps/web/${entry.source}`,
        component: entry.component,
      })
      expect(included(entry.template)).toBe(true)
    }
  })

  test('all and only listed template files are included', () => {
    const files = [...new Bun.Glob('**/*.figma.ts').scanSync({ cwd: root })]
      .filter((path) => path.startsWith('client/') || path.startsWith('components/'))
    expect(files.sort()).toEqual([...templates].sort())
    expect(config.codeConnect.label).toBe('React')
    expect(config.codeConnect.language).toBe('jsx')
  })

  test('the design inventory agrees with this mapping on node ownership', () => {
    expect(inventory.codeConnect.nodeOwnership).toBe('apps/web/figma-components.json')
    expect(mapping.componentDirectory).toBe('figma/components')
    const owners = new Map(mapping.components.map((entry) => [entry.nodeId, entry]))
    const notMapped = new Set(mapping.notMapped.map(({ nodeId }) => nodeId))
    for (const item of inventory.components) {
      const owner = owners.get(item.nodeId)
      if (owner) {
        expect(item.codeComponentName, item.figmaName).toBe(owner.component)
        expect(item.codeSourcePath, item.figmaName).toBe(`apps/web/${owner.source}`)
      } else {
        expect(notMapped.has(item.nodeId) || item.codeConnectStatus.startsWith('mapped (#789)'), item.figmaName).toBe(true)
      }
    }
  })

  test('unmapped source paths remain importable', () => {
    for (const { source } of mapping.notInFigma) expect(exportNames[source]?.length ?? 0).toBeGreaterThan(0)
  })
})
