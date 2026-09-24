// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=282-5961
// source=apps/web/components/copyable-value.tsx
// component=CopyableValue
import figma from 'figma'
const i = figma.selectedInstance
const value = i.getString('Value#282:13')
const display = i.getEnum('display', { truncated: 'compact', full: 'full' })
export default { example: figma.code`<CopyableValue value={${JSON.stringify(value)}} presentation="${display}" />`, imports: ['import { CopyableValue } from "@/components/copyable-value"'], id: 'copyable-value', metadata: { nestable: true } }
