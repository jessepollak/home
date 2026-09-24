// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=160-1826
// source=apps/web/components/ui/toggle.tsx
// component=Toggle
import figma from 'figma'
const i = figma.selectedInstance
const label = i.getString('Label#160:30')
const variant = i.getEnum('variant', { default: 'default', outline: 'outline' })
const size = i.getEnum('size', { default: 'default', sm: 'sm', lg: 'lg' })
const state = i.getEnum('state', { on: 'on', disabled: 'disabled' })
export default { example: figma.code`<Toggle variant="${variant}" size="${size}"${state === 'on' ? figma.code` pressed` : null}${state === 'disabled' ? figma.code` disabled` : null}>{${JSON.stringify(label)}}</Toggle>`, imports: ['import { Toggle } from "@/components/ui/toggle"'], id: 'toggle', metadata: { nestable: true } }
