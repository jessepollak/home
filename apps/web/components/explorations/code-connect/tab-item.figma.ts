// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=12-94
// source=apps/web/components/primary-navigation.tsx
// component=PrimaryNavigation
// TabItem is internal to PrimaryNavigation; its label and icon are fixed by route.
// Icon=Card belongs to the Card proposal; code has no Card tab, so it renders Home.
import figma from 'figma'
const i = figma.selectedInstance
const icon = i.getEnum('Icon', { Home: 'home', Invest: 'invest', Card: 'home' })
const active = i.getBoolean('Active#12:37')
export default { example: figma.code`<PrimaryNavigation activeNavigation="${active ? icon : icon === 'home' ? 'invest' : 'home'}" onNavigate={onNavigate} />`, imports: ['import { PrimaryNavigation } from "@/components/primary-navigation"'], id: 'tab-item', metadata: { nestable: false } }
