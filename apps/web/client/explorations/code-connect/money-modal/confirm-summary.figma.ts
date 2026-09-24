// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=166-1803
// source=apps/web/client/money-modal/confirm-summary.tsx
// component=MoneyConfirmSummary
import figma from 'figma'
const i = figma.selectedInstance
const amount = i.getString('Amount#166:20')
const lead = i.getString('Lead#166:21')
export default { example: figma.code`<MoneyConfirmSummary amount={${JSON.stringify(amount)}} lead={${JSON.stringify(lead)}} rows={rows} />`, imports: ['import { MoneyConfirmSummary } from "@/client/money-modal/confirm-summary"'], id: 'money-confirm-summary', metadata: { nestable: false } }
