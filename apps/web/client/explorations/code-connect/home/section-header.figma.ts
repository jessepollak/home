// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=12-33
// source=apps/web/client/home/home-overview.tsx
// component=HomeSectionHeading
import figma from 'figma'
const title = figma.selectedInstance.getString('Title#12:16')
export default { example: figma.code`<HomeSectionHeading id="money-heading">{${JSON.stringify(title)}}</HomeSectionHeading>`, imports: ['import { HomeSectionHeading } from "@/client/home/home-overview"'], id: 'section-header', metadata: { nestable: true } }
