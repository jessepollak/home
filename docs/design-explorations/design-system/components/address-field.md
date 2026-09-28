# AddressField

| Item | Code | Story and historical design | MVP | Built on | Owner | P |
| --- | --- | --- | --- | --- | --- | --- |
| AddressField | yes (Send destination step: free-form address or Basename/ENS, paste button, resolution status below) | `ui-address-field--*` covers empty, focused, entered and disabled states, input formatting, and paste (#953). `SendRecipientStatus` is sibling content rather than an input state; `journeys-send-recipient--*` covers resolving, resolved, recovery, recent selection, and review. | yes | Field + InputGroup | `components/address-field.tsx` | P1 |
