// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=269-5270
// source=apps/web/components/ui/card.tsx
// component=Card
import figma from 'figma'
const i = figma.selectedInstance
const variant = i.getEnum('variant', { default: 'default', flush: 'flush' })
const inset = i.getEnum('inset', { list: 'list', default: 'default', hero: 'hero' })
const content = i.getSlot('CardContent#269:2')
export default { example: figma.code`<Card variant="${variant}"><CardContent inset="${inset}">${content}</CardContent></Card>`, imports: ['import { Card, CardContent } from "@/components/ui/card"'], id: 'card', metadata: { nestable: true } }
