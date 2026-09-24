// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=158-1862
// source=apps/web/components/ui/alert.tsx
// component=Alert
import figma from 'figma'
const i = figma.selectedInstance
const variant = i.getEnum('variant', { default: 'default', destructive: 'destructive' })
const title = i.getString('Title#158:14')
const description = i.getString('Description#158:17')
const icon = i.getBoolean('Show icon#158:20')
const action = i.getBoolean('Show action#158:23')
const actionLabel = i.getString('Action#311:0')
export default { example: figma.code`<Alert variant="${variant}">${icon ? figma.code`<Info aria-hidden="true" />` : null}<AlertTitle>{${JSON.stringify(title)}}</AlertTitle><AlertDescription>{${JSON.stringify(description)}}</AlertDescription>${action ? figma.code`<AlertAction><Button>{${JSON.stringify(actionLabel)}}</Button></AlertAction>` : null}</Alert>`, imports: ['import { Alert, AlertTitle, AlertDescription, AlertAction } from "@/components/ui/alert"', 'import { Button } from "@/components/ui/button"', 'import { Info } from "lucide-react"'], id: 'alert', metadata: { nestable: true } }
