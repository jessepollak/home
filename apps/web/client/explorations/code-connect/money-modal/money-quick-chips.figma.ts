// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=166-1787
// source=apps/web/client/money-modal/amount.tsx
// component=MoneyQuickChips
import figma from 'figma'
const chipSet = figma.selectedInstance.getEnum('chipSet', { 'quick-local': 'quick-local', max: 'max' })
export default { example: figma.code`<MoneyQuickChips chipSet="${chipSet}" localCurrency="USD" primaryUnit="local" availableAmount={availableAmount} onSelect={onSelect} />`, imports: ['import { MoneyQuickChips } from "@/client/money-modal/amount"'], id: 'money-quick-chips', metadata: { nestable: false } }
