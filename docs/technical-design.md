# Moved: technical design

This path used to hold the 2026-09-07 production-destination design. It is **target architecture, not the current tree**.

**Go here instead:** [target architecture](target-architecture.md)

**Current tree (start here):**

1. [Home is thin](home-is-thin.md) — action and client contract
2. [Build status](build-status.md) — local-app boundary
3. [Vercel deploy](vercel-deploy.md) — Bun monorepo build settings
4. [Architecture review](architecture-review-2026-09.md) — current-tree boundaries
5. [Docs index](README.md)

The Neon / Vercel / webhook design was not deleted. It lives at the target-architecture link above. The current app uses the thin Postgres action schema when `DATABASE_URL` is configured; Drizzle, webhooks, and the rest of the target stack are not current-tree contracts.
