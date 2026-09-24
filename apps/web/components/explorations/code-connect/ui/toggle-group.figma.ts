// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=160-1849
// source=apps/web/components/ui/toggle-group.tsx
// component=ToggleGroup
import figma from 'figma'
const variant = figma.selectedInstance.getEnum('variant', { default: 'default', outline: 'outline' })
export default { example: figma.code`<ToggleGroup variant="${variant}"><ToggleGroupItem value="option">Option</ToggleGroupItem></ToggleGroup>`, imports: ['import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"'], id: 'toggle-group', metadata: { nestable: true } }
