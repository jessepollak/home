# AddressField

| Item | Code | Figma | MVP | Built on | Owner | P |
| --- | --- | --- | --- | --- | --- | --- |
| AddressField | yes (Send destination step: free-form address or Basename/ENS, paste button, resolution status below) | `460:4469` state=empty\|focused\|entered\|disabled, code parity (#953). Entered is a valid address while unfocused, shortened by `formatAddress` to the first and last 6 characters (`0x2211…d77DA9`); focused shows the full value; other text is never shortened. Label addon, `Home/Mono base` input (16/24 on mobile) and a 44px ghost paste button with the new `clipboard-paste` Icon. The resolution status is the Figma-only `SendRecipientStatus` (`465:4497`, resolving\|resolved\|could-not-resolve\|hint), sibling content rather than a state | yes | Field + InputGroup | `components/address-field.tsx` | P1 |
