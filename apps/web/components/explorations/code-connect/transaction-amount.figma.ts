// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=282-5882
// source=apps/web/components/transaction-amount.tsx
// component=TransactionAmount
import figma from 'figma'
const i = figma.selectedInstance
const amount = i.getString('Amount#282:3')
const tone = i.getEnum('tone', { default: 'default', success: 'success' })
export default { example: figma.code`<TransactionAmount amount={${JSON.stringify(amount)}} tone="${tone}" status={{ label: "Confirmed", tone: "success" }} />`, imports: ['import { TransactionAmount } from "@/components/transaction-amount"'], id: 'transaction-amount' }
