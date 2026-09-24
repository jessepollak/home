// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=161-1847
// source=apps/web/components/ui/drawer.tsx
// component=DrawerContent
import figma from 'figma'
const i = figma.selectedInstance
const title = i.getString('Title#161:80')
const content = i.getSlot('DrawerContent#274:0')
const footer = i.getSlot('DrawerFooter#274:3')
const showFooter = i.getBoolean('Show footer#161:83')
export default { example: figma.code`<Drawer><DrawerContent><DrawerHeader><DrawerTitle>{${JSON.stringify(title)}}</DrawerTitle></DrawerHeader>${content}${showFooter ? figma.code`<DrawerFooter>${footer}</DrawerFooter>` : null}</DrawerContent></Drawer>`, imports: ['import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter } from "@/components/ui/drawer"'], id: 'drawer', metadata: { nestable: false } }
