// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=385-4124
// source=apps/web/components/ui/feature-intro.tsx
// component=FeatureIntro
import figma from 'figma'
const i = figma.selectedInstance
const headline = i.getString('Headline#385:0')
const reason = i.getString('Reason#385:10')
const illustration = i.getBoolean('Show illustration#385:20')
const secondary = i.getBoolean('Show secondary#385:40')
const fourthBenefit = i.getBoolean('Show 4th benefit#385:50')
const state = i.getEnum('state', { default: 'default', pending: 'pending', unavailable: 'unavailable' })
export default { example: figma.code`<FeatureIntro headline={${JSON.stringify(headline)}} benefits={[{ icon: Store, text: "Pay in stores and online" }, { icon: Lock, text: "Lock it anytime" }, { icon: Banknote, text: "Spend straight from your balance" }${fourthBenefit ? ', { icon: ReceiptText, text: "Track every purchase as it lands" }' : ''}]} ${illustration ? 'illustration="card" ' : ''}primary={{ label: "Get your card", onClick: () => {}${state === 'pending' ? ', pending: true' : ''} }} ${state === 'unavailable' ? `availability={{ kind: "unavailable", reason: ${JSON.stringify(reason)} }} ` : ''}${secondary ? 'secondary={{ label: "Not now", onClick: () => {} }} ' : ''}/>`, imports: ['import { FeatureIntro } from "@/components/ui/feature-intro"', 'import { Store, Lock, Banknote, ReceiptText } from "lucide-react"'], id: 'feature-intro' }
