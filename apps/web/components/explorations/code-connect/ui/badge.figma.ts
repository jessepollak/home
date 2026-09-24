// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=158-1841
// source=apps/web/components/ui/badge.tsx
// component=Badge
import figma from 'figma'
const i = figma.selectedInstance
const label = i.getString('Label#158:0')
const icon = i.getBoolean('Show icon#158:7')
const variant = i.getEnum('variant', { default: 'default', secondary: 'secondary', destructive: 'destructive', outline: 'outline', ghost: 'ghost', link: 'link' })
export default { example: figma.code`<Badge variant="${variant}">${icon ? figma.code`<CircleHelp aria-hidden="true" />` : null}{${JSON.stringify(label)}}</Badge>`, imports: ['import { Badge } from "@/components/ui/badge"', 'import { CircleHelp } from "lucide-react"'], id: 'badge', metadata: { nestable: true } }
