import file from '../../figma-components.json'

type Component = {
  figmaName: string
  nodeId: string
  source: string
  component: string
  template: string
  stories: string[]
}

const directory = `${import.meta.dir}/../../${file.componentDirectory}`
const files = [...new Bun.Glob('*.json').scanSync({ cwd: directory })].sort()
const components: Component[] = await Promise.all(files.map(async (name) => {
  // oxlint-disable-next-line home/no-source-reads -- Mapping JSON is test data, not product source.
  return await Bun.file(`${directory}/${name}`).json() as Component
}))

export const componentFiles = files
const mapping = { ...file, components }
export default mapping
