# Styling guards

Use shadcn components and their variants as shipped. Never add global selectors or `:has()` anchors above dynamic content: a `:has()` on `:root`, `html`, `body`, a list, a card, or a layout container makes every row mount recalculate style for the whole subtree. Use the direct-child form (`has-[>…]`) when a component must react to its own slot. When a styling rule fires, change the owned component variant instead of suppressing the rule or adding an allowlist entry; the enforced guards are listed in [Styling guards](../gates.md#styling-guards).
