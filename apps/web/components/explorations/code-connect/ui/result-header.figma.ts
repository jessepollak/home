// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=166-1884
// source=apps/web/components/ui/result-header.tsx
// component=ResultHeader
import figma from 'figma'
const outcome = figma.selectedInstance.getEnum('outcome', { success: 'success', pending: 'pending', failed: 'failed', unknown: 'unknown' })
export default { example: figma.code`<ResultHeader outcome="${outcome}" title="Transfer result" />`, imports: ['import { ResultHeader } from "@/components/ui/result-header"'], id: 'result-header' }
