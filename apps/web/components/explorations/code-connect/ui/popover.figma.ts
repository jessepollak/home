// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=292-5883
// source=apps/web/components/ui/popover.tsx
// component=PopoverContent
import figma from 'figma'
const i = figma.selectedInstance
const description = i.getString('Description#292:0')
const action = i.getBoolean('Show action#292:1')
export default { example: figma.code`<Popover><PopoverTrigger>Details</PopoverTrigger><PopoverContent>{${JSON.stringify(description)}}${action ? figma.code`<Button>Retry</Button>` : null}</PopoverContent></Popover>`, imports: ['import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"', 'import { Button } from "@/components/ui/button"'], id: 'popover', metadata: { nestable: false } }
