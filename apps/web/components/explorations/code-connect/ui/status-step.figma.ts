// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=166-1861
// source=apps/web/components/ui/status-step.tsx
// component=StatusStep
import figma from 'figma'
const i = figma.selectedInstance
const status = i.getEnum('status', { complete: 'complete', current: 'current', upcoming: 'upcoming', failed: 'failed' })
const connector = i.getBoolean('Show connector#166:23')
export default { example: figma.code`<StatusSteps><StatusStep status="${status}" title="Confirming on Base" showConnector={${connector}} /></StatusSteps>`, imports: ['import { StatusSteps, StatusStep } from "@/components/ui/status-step"'], id: 'status-step' }
