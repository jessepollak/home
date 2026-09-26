# Token amounts

`formatPresentationTokenAmount` owns read-only token display. Amounts use the token's atomic base units and decimals, never floating-point conversion.

| Asset class | At or above threshold | Below threshold |
| --- | --- | --- |
| Stable (including USDC) | 2 fixed fraction digits | 2 fixed fraction digits |
| Major (including ETH and cbBTC) | At least 0.01: 4 fixed fraction digits | Below 0.01: up to 6 fraction digits, trailing zeros trimmed |
| Meme / other | At least 1: 2 fixed fraction digits | Below 1: up to 6 fraction digits, trailing zeros trimmed |

Fraction digits never exceed the token's decimals. Extra digits are truncated, never rounded up, so a displayed quantity never exceeds the held amount. A nonzero amount too small to show uses a `<` threshold at the class's visible precision (for example, `<0.000001 DEGEN` or `<0.01 USDC`), so a nonzero quantity never displays as zero. True zero displays `0`, padded only where the class has fixed digits (`0.00 USDC`, `0 ETH`, `0 ZORA`). Sign and grouping follow the presentation region; negative amounts use `−`, positive amounts have no automatic `+` (a directional surface may add one). Never use scientific notation or ellipsis for the numeric value.

Synthetic examples from the formatter (default region unless specified):

| Atomic base units | Decimals | Token | Display |
| --- | ---: | --- | --- |
| `1234567890123456789012` | 18 | ZORA | `1,234.56 ZORA` |
| `420000000000` | 18 | DEGEN | `<0.000001 DEGEN` |
| `420000000000000000` | 18 | DEGEN | `0.42 DEGEN` |
| `1234567` | 0 | TOKEN1 | `1,234,567 TOKEN1` |
| `1500000000000000000` | 18 | ETH | `1.5000 ETH` |
| `25000000` | 6 | USDC | `25.00 USDC` |
| `0` | 6 | USDC | `0.00 USDC` |
| `1234567890123456789012` | 18 | ZORA (DE, de-DE) | `1.234,56 ZORA` |
| `1500000000000000000` | 18 | ETH (DE, de-DE) | `1,5000 ETH` |

Activity rows and details, balances/holdings, and Borrow summaries use the bounded presentation policy. Pre-signing review/confirm facts, Max, input, authorization, and signing remain exact; `formatExactPresentationTokenAmount` owns exact review/confirm display. An upper-bound amount (`maximum`, shown as "Up to", such as a pending repay-all debit ceiling) is an authorized limit, not a read-only quantity: rows and details show it exactly (`100.000362 USDC`, never `100.00 USDC`) so truncation never understates it. Once settled, the actual amount uses the bounded policy. Presentation rounding must not change atomic amounts.

In a detail headline, pass the numeric amount (including sign and `<`) and symbol separately. The number never wraps: it shrinks to fit, but not below 1.5rem so enlarged text is respected. Past that minimum, it scrolls horizontally inside the sheet as a keyboard-focusable region. The symbol may wrap independently onto another line, including within a long symbol.
