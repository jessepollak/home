// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=12-39
// source=apps/web/client/home/balances-panel.tsx
// component=BalancesPage
// MoneyGroupHeader is internal; BalancesPage derives its label and subtotal from assetBalances.
import figma from 'figma'
export default { example: figma.code`<BalancesPage active assetBalances={balances} showSmallBalances={false} revealSmallBalances={false} onRevealSmallBalancesChange={onRevealSmallBalancesChange} isChecking={false} revealedCount={0} onRevealMore={onRevealMore} />`, imports: ['import { BalancesPage } from "@/client/home/balances-panel"'], id: 'money-group-header', metadata: { nestable: false } }
