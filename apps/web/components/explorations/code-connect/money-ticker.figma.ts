// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=12-2
// source=apps/web/components/money-ticker.tsx
// component=MoneyTicker
import figma from 'figma'
const amount = figma.selectedInstance.getString('Amount#12:1')
export default { example: figma.code`<MoneyTicker value={${JSON.stringify(amount)}} />`, imports: ['import { MoneyTicker } from "@/components/money-ticker"'], id: 'money-ticker', metadata: { nestable: true } }
