// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=158-1880
// source=apps/web/components/ui/label.tsx
// component=Label
import figma from 'figma'
const i = figma.selectedInstance
const label = i.getString('Label#158:26')
const disabled = i.getEnum('state', { disabled: true })
export default { example: figma.code`<Label${disabled ? figma.code` aria-disabled` : null}>{${JSON.stringify(label)}}</Label>`, imports: ['import { Label } from "@/components/ui/label"'], id: 'label', metadata: { nestable: true } }
