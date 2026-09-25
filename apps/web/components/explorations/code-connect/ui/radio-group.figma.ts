// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=160-1801
// source=apps/web/components/ui/radio-group.tsx
// component=RadioGroupOption
import figma from 'figma'
const i = figma.selectedInstance
const label = i.getString('Label#160:21')
const checked = i.getEnum('checked', { true: true })
const disabled = i.getEnum('state', { disabled: true })
const error = i.getEnum('state', { error: true })
export default { example: figma.code`<div><FieldTitle id="figma-radio-title">Payment method</FieldTitle><RadioGroup aria-labelledby="figma-radio-title"${checked ? figma.code` defaultValue="method"` : null}${disabled ? figma.code` disabled` : null}${error ? figma.code` aria-invalid aria-describedby="figma-radio-error"` : null}><RadioGroupOption value="method" label={${JSON.stringify(label)}}${disabled ? figma.code` disabled` : null}${error ? figma.code` invalid` : null} /></RadioGroup>${error ? figma.code`<FieldError id="figma-radio-error">Choose a payment method.</FieldError>` : null}</div>`, imports: ['import { RadioGroup, RadioGroupOption } from "@/components/ui/radio-group"', 'import { FieldError, FieldTitle } from "@/components/ui/field"'], id: 'radio-group', metadata: { nestable: true } }
