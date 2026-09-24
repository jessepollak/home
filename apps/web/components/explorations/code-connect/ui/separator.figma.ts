// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=158-1872
// source=apps/web/components/ui/separator.tsx
// component=Separator
import figma from 'figma'
const orientation = figma.selectedInstance.getEnum('orientation', { horizontal: 'horizontal', vertical: 'vertical' })
export default { example: figma.code`<Separator orientation="${orientation}" />`, imports: ['import { Separator } from "@/components/ui/separator"'], id: 'separator', metadata: { nestable: true } }
