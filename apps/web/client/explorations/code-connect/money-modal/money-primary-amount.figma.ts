// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=166-1776
// source=apps/web/client/money-modal/amount.tsx
// component=MoneyPrimaryAmount
// Empty and entered states derive from amount; availability errors belong to MoneyAmountDisplay.
import figma from 'figma'
export default { example: figma.code`<MoneyPrimaryAmount amount={amount} onAmountChange={(value) => setAmount(value)} maxDecimals={6} unit={unit} pricing={pricing} nativeSymbol="ETH" />`, imports: ['import { MoneyPrimaryAmount } from "@/client/money-modal/amount"'], id: 'money-primary-amount', metadata: { nestable: false } }
