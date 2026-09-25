// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=160-1654
// source=apps/web/components/ui/input.tsx
// component=Input
import figma from 'figma'
const i = figma.selectedInstance
const value = i.getString('Value#160:0')
const variant = i.getEnum('variant', { default: 'default', otp: 'default', code: 'code' })
const state = i.getEnum('state', { disabled: 'disabled', error: 'error', filled: 'filled' })
export default { example: figma.code`<Input variant="${variant}" placeholder={${JSON.stringify(value)}}${state === 'filled' ? figma.code` defaultValue={${JSON.stringify(value)}}` : null}${state === 'disabled' ? figma.code` disabled` : null}${state === 'error' ? figma.code` aria-invalid` : null} />`, imports: ['import { Input } from "@/components/ui/input"'], id: 'input', metadata: { nestable: true } }
