// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=211-3668
// source=apps/web/components/ui/input-otp.tsx
// component=InputOTP
import figma from 'figma'
const i = figma.selectedInstance
const state = i.getEnum('state', { filled: 'filled', error: 'error', disabled: 'disabled' })
export default { example: figma.code`<InputOTP maxLength={6}${state === 'filled' || state === 'error' ? figma.code` defaultValue="123456"` : null}${state === 'error' ? figma.code` aria-invalid` : null}${state === 'disabled' ? figma.code` disabled` : null}><InputOTPGroup><InputOTPSlot index={0} /><InputOTPSlot index={1} /><InputOTPSlot index={2} /><InputOTPSlot index={3} /><InputOTPSlot index={4} /><InputOTPSlot index={5} /></InputOTPGroup></InputOTP>`, imports: ['import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"'], id: 'input-otp', metadata: { nestable: true } }
