// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=460-4469
// source=apps/web/components/address-field.tsx
// component=AddressField
import figma from 'figma'
const i = figma.selectedInstance
const label = i.getString('Label#460:0')
const placeholder = i.getString('Placeholder#460:10')
const configured = i.getString('Value#460:5')
const disabled = i.getEnum('state', { disabled: true })
const filled = i.getEnum('state', { entered: true, focused: true })
const value = filled ? (configured === '0x2211…d77DA9' ? '0x2211d1D0020DAEA8039E46Cf1367962070d77DA9' : configured) : ''
export default { example: figma.code`<AddressField id="recipient" label={${JSON.stringify(label)}} placeholder={${JSON.stringify(placeholder)}} value={${JSON.stringify(value)}} onChange={() => {}}${disabled ? figma.code` disabled` : null} />`, imports: ['import { AddressField } from "@/components/address-field"'], id: 'address-field', metadata: { nestable: true } }
