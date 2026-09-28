# Components

Owned component copies live in `apps/web/components/ui`. Product code composes those wrappers instead of importing Base UI primitives directly.

Add a component (uses the pinned `shadcn` CLI in `apps/web`):

```sh
cd apps/web
bunx shadcn add <name>
```

Review every generated copy before committing it. Stock Tailwind scale utilities are allowed; replace hex/rgba, arbitrary-pixel, and raw palette classes with semantic tokens.

The pinned `shadcn` CLI's own composition rules are installed as the committed [shadcn skill](../../.agents/skills/shadcn/SKILL.md) (`bunx skills add shadcn/ui --skill shadcn -a universal --copy -y`, recorded in `skills-lock.json`). Its `rules/` files are the source of composition guidance — starting from existing owned components and variants instead of hand-rolling UI. [Home's own rules](rules.md) still win where they are stricter. Its component names are not Home's owned inventory: `NativeSelect`, `Textarea`, and `Tabs` have no copy under `apps/web/components/ui`, so add the owned component with the CLI before composing it.
