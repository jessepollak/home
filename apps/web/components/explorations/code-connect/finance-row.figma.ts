// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=96-1147
// source=apps/web/components/finance-rows.tsx
// component=BalanceRow
// FinanceRow is internal; BalanceRow is its exported balance wrapper (ActivityRow for activity).
import figma from 'figma'
const i = figma.selectedInstance
const label = i.getString('Label#96:0')
const context = i.getString('Context#96:1')
const value = i.getString('Value#96:3')
const valueContext = i.getString('Value context#96:7')
const mark = i.getInstanceSwap('Mark#96:5')
const tone = i.getEnum('Value tone', { Success: 'success', Error: 'error', Muted: 'muted', Default: 'default' })
export default { example: figma.code`<BalanceRow icon={${mark ? mark.executeTemplate().example : figma.code`<CurrencyMark symbol="$" />`}} label={${JSON.stringify(label)}}${i.getBoolean('Show context#96:2') ? figma.code` context={${JSON.stringify(context)}}` : null} value={${JSON.stringify(value)}}${i.getBoolean('Show value context#96:6') ? figma.code` valueContext={${JSON.stringify(valueContext)}}` : null} valueTone="${tone}"${i.getBoolean('Show chevron#96:4') ? figma.code` onActivate={onActivate}` : figma.code` chevron={false}`} />`, imports: ['import { BalanceRow } from "@/components/finance-rows"', 'import { CurrencyMark } from "@/components/currency-mark"'], id: 'finance-row', metadata: { nestable: true } }
