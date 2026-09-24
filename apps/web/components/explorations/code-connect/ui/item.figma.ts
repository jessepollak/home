// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=161-1818
// source=apps/web/components/ui/item.tsx
// component=Item
import figma from 'figma'
const i = figma.selectedInstance
const title = i.getString('Title#161:0')
const description = i.getString('Description#161:16')
const variant = i.getEnum('variant', { default: 'default', outline: 'outline', muted: 'muted', flush: 'flush' })
const size = i.getEnum('size', { default: 'default', sm: 'sm', xs: 'xs' })
export default { example: figma.code`<Item variant="${variant}" size="${size}">${i.getBoolean('Show media#161:32') ? figma.code`<ItemMedia variant="icon"><CurrencyMark currency="USD" /></ItemMedia>` : null}<ItemContent><ItemTitle>{${JSON.stringify(title)}}</ItemTitle>${i.getBoolean('Show description#161:48') ? figma.code`<ItemDescription>{${JSON.stringify(description)}}</ItemDescription>` : null}</ItemContent>${i.getBoolean('Show actions#161:64') ? figma.code`<ItemActions><Button>Open</Button></ItemActions>` : null}</Item>`, imports: ['import { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from "@/components/ui/item"', 'import { CurrencyMark } from "@/components/currency-mark"', 'import { Button } from "@/components/ui/button"'], id: 'item', metadata: { nestable: true } }
