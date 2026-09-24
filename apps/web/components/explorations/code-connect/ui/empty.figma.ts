// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=161-1904
// source=apps/web/components/ui/empty.tsx
// component=Empty
import figma from 'figma'
const i = figma.selectedInstance
const title = i.getString('Title#161:93')
const description = i.getString('Description#161:96')
const action = i.getBoolean('Show action#161:99')
const media = i.getEnum('media', { icon: 'icon' })
export default { example: figma.code`<Empty><EmptyHeader>${media === 'icon' ? figma.code`<EmptyMedia variant="icon"><CircleHelp aria-hidden="true" /></EmptyMedia>` : null}<EmptyTitle>{${JSON.stringify(title)}}</EmptyTitle><EmptyDescription>{${JSON.stringify(description)}}</EmptyDescription></EmptyHeader>${action ? figma.code`<EmptyContent><Button>Continue</Button></EmptyContent>` : null}</Empty>`, imports: ['import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty"', 'import { Button } from "@/components/ui/button"', 'import { CircleHelp } from "lucide-react"'], id: 'empty', metadata: { nestable: true } }
