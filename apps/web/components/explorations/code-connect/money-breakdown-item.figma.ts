// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=12-20
// source=apps/web/components/signed-balance-bar.tsx
// component=MoneyBreakdownLegend
// MoneyBreakdownLegend renders one item per breakdown entry; Savings is grouped into Cash in code.
import figma from 'figma'
const i = figma.selectedInstance
const amount = i.getString('Amount#12:9')
const kind = i.getEnum('Kind', { Cash: 'cash', Savings: 'cash', Investments: 'investments', Borrow: 'borrow' })
const label = i.getEnum('Kind', { Cash: 'Cash', Savings: 'Cash', Investments: 'Investments', Borrow: 'Borrow' })
export default { example: figma.code`<MoneyBreakdownLegend items={[{ id: "${kind}", label: "${label}", value: ${JSON.stringify(amount)}, weight: 1 }]} selectedId={null} onSelect={() => {}} />`, imports: ['import { MoneyBreakdownLegend } from "@/components/signed-balance-bar"'], id: 'money-breakdown-item', metadata: { nestable: true } }
