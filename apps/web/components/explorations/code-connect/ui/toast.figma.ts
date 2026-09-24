// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=161-1885
// source=apps/web/components/ui/toast.tsx
// component=Toast
import figma from 'figma'
const title = figma.selectedInstance.getString('Title#161:86')
export default { example: figma.code`<Toast toast={toastItem}><ToastContent><ToastTitle>{${JSON.stringify(title)}}</ToastTitle></ToastContent></Toast>`, imports: ['import { Toast, ToastContent, ToastTitle } from "@/components/ui/toast"'], id: 'toast', metadata: { nestable: false } }
