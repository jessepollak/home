// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=12-59
// source=apps/web/components/currency-mark.tsx
// component=CurrencyMark
// CurrencyMarkSlot is internal; CurrencyMark resolves images and flags from asset data.
import figma from 'figma'
const i = figma.selectedInstance
const glyph = i.getString('Glyph#12:23')
const kind = i.getEnum('Kind', { Flag: 'USD', USDC: 'USDC', Generic: '', Bitcoin: 'BTC', Ethereum: 'ETH', Borrow: '', Cash: 'USD', Investments: '', Shimmer: '', Card: '', Freeze: '' })
const pending = i.getEnum('Kind', { Shimmer: true })
export default { example: figma.code`<CurrencyMark symbol={${JSON.stringify(glyph)}} currency={${JSON.stringify(kind ?? '')}}${pending ? figma.code` pending` : null} />`, imports: ['import { CurrencyMark } from "@/components/currency-mark"'], id: 'currency-mark-slot', metadata: { nestable: true } }
