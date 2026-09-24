// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=160-1673
// source=apps/web/components/ui/input-group.tsx
// component=InputGroup
import figma from 'figma'
const i = figma.selectedInstance
const placeholder = i.getString('Placeholder#160:10')
const error = i.getEnum('state', { error: true })
const showAddon = i.getBoolean('Show addon#160:14')
export default { example: figma.code`<InputGroup>${showAddon ? figma.code`<InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>` : null}<InputGroupInput placeholder={${JSON.stringify(placeholder)}}${error ? figma.code` aria-invalid` : null} /></InputGroup>`, imports: ['import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"', 'import { Search } from "lucide-react"'], id: 'input-group', metadata: { nestable: true } }
