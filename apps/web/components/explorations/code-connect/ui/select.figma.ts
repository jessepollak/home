// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=160-1718
// source=apps/web/components/ui/select.tsx
// component=SelectTrigger
import figma from 'figma'
const state = figma.selectedInstance.getEnum('state', { disabled: 'disabled', error: 'error' })
export default { example: figma.code`<Select><SelectTrigger${state === 'disabled' ? figma.code` disabled` : null}${state === 'error' ? figma.code` aria-invalid` : null}><SelectValue /></SelectTrigger></Select>`, imports: ['import { Select, SelectTrigger, SelectValue } from "@/components/ui/select"'], id: 'select', metadata: { nestable: true } }
