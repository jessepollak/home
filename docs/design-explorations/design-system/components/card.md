# Card

| Item | Code | Figma | MVP | Base UI underneath | Owner | P |
| --- | --- | --- | --- | --- | --- | --- |
| Card | yes | `269:5270` set: `variant=flush, inset=list` (`269:5196`, standard list block), `variant=flush, inset=hero` (`301:5912`, HomeTotalBalance: 16px padding, 8px slot gap) used by every TotalBalanceCard on Home — final and Home states, `variant=default, inset=list` (`273:5531`, CardHeader + list), and `variant=default, inset=default` (`269:5244`), each with a native `CardContent` slot. The `inset` options are list, default and hero | yes | none (div) | `components/ui/card.tsx` | P0 |
