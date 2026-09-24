// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=160-1684
// source=apps/web/components/ui/field.tsx
// component=Field
import figma from 'figma'
const i = figma.selectedInstance
const label = i.getString('Label#160:18')
const description = i.getString('Description#282:4')
const control = i.getSlot('FieldControl#282:7')
const error = i.getEnum('state', { error: true })
export default { example: figma.code`<Field${error ? figma.code` aria-invalid` : null}><FieldLabel>{${JSON.stringify(label)}}</FieldLabel>${control}<FieldDescription>{${JSON.stringify(description)}}</FieldDescription></Field>`, imports: ['import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"'], id: 'field', metadata: { nestable: true } }
