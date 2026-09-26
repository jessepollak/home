// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=161-1923
// source=apps/web/components/ui/progress.tsx
// component=Progress
import figma from 'figma'
const value = figma.selectedInstance.getEnum('value', { '40': 40, '100': 100 })
export default { example: figma.code`<Progress label="Progress" value={${value}} max={100} />`, imports: ['import { Progress } from "@/components/ui/progress"'], id: 'progress', metadata: { nestable: true } }
