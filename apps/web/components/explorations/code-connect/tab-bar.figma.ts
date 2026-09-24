// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=12-95
// source=apps/web/components/primary-navigation.tsx
// component=PrimaryNavigation
// TabBar is internal to PrimaryNavigation; supply the active route and navigation handler.
import figma from 'figma'
export default { example: figma.code`<PrimaryNavigation activeNavigation="home" onNavigate={onNavigate} />`, imports: ['import { PrimaryNavigation } from "@/components/primary-navigation"'], id: 'tab-bar', metadata: { nestable: false } }
