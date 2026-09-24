// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=160-1772
// source=apps/web/components/ui/switch.tsx
// component=Switch
import figma from 'figma'
const i = figma.selectedInstance
const checked = i.getEnum('checked', { true: true })
const disabled = i.getEnum('state', { disabled: true })
export default { example: figma.code`<Switch${checked ? figma.code` defaultChecked` : null}${disabled ? figma.code` disabled` : null} />`, imports: ['import { Switch } from "@/components/ui/switch"'], id: 'switch', metadata: { nestable: true } }
