// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=12-27
// source=apps/web/components/ui/button.tsx
// component=Button
import figma from 'figma'
const instance = figma.selectedInstance
const label = instance.getString('Label#12:14')
const showIcon = instance.getBoolean('Show icon#12:15')
const icon = instance.getInstanceSwap('Icon#271:0')
const swappedIcon = icon?.type === 'INSTANCE' ? icon : null
const iconValue = swappedIcon && !swappedIcon.hasCodeConnect() ? swappedIcon.getPropertyValue('icon') : null
const iconName = typeof iconValue === 'string' && /^[a-z]+(?:-[a-z]+)*$/.test(iconValue)
  ? iconValue.replace(/(^|-)([a-z])/g, (_, _separator, letter: string) => letter.toUpperCase()) : null
const iconExample = swappedIcon?.hasCodeConnect() ? swappedIcon.executeTemplate().example : iconName ? figma.code`<${iconName} />` : null
const variant = instance.getEnum('variant', { default: 'default', outline: 'outline', secondary: 'secondary', ghost: 'ghost', destructive: 'destructive', link: 'link' })
const size = instance.getEnum('size', { touch: 'lg', xs: 'xs', sm: 'sm', default: 'default', lg: 'lg', 'icon-sm': 'icon-sm', icon: 'icon', 'icon-lg': 'icon-lg' })
const state = instance.getEnum('state', { disabled: 'disabled', loading: 'loading' })
export default {
  example: figma.code`<Button variant="${variant}" size="${size}"${instance.getEnum('size', { touch: true }) ? figma.code` className="h-11"` : null}${state === 'disabled' ? figma.code` disabled` : null}${state === 'loading' ? figma.code` loading` : null}>${showIcon ? iconExample : null}{${JSON.stringify(label)}}</Button>`,
  imports: ['import { Button } from "@/components/ui/button"', ...(showIcon && iconName && !swappedIcon?.hasCodeConnect() ? [`import { ${iconName} } from "lucide-react"`] : [])], id: 'button', metadata: { nestable: true },
}
