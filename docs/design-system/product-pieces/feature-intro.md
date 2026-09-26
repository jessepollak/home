# Feature intro

- `apps/web/components/ui/feature-intro.tsx` owns the feature-intro CTA (#895, option C): `FeatureIntro` is an inline card (`size="default" | "compact"`), `FeatureIntroSheet` is a drawer whose headline names the dialog and whose dismiss secondary is required, and `FeatureIntroSkeleton` is the loading placeholder.
- Product code supplies content only: a headline (≤28 characters), optional description (≤80 characters), 2–4 benefits (≤32 characters each, with a lucide icon), one primary action, optional secondary action, and optional unavailable reason with recovery. The `illustration` subject is `card` or `savings`; both are static Line & Plane stand-ins until #896.
- Use an intro when a feature is available but not started, or one fixable step away (such as verification). Do not use it for errors, loading, empty data after a feature has started, Home, mid-flow upsells, or legal/eligibility copy. Keep one primary per screen; never stack it with another primary.
- Current production use: Save before the first deposit. Its `Get started` opens the existing deposit sheet. Card states (not issued, needs verification, region unavailable) exist only as stories until #821.
- Icon choice describes the state in the copy: Save’s “No lockups” uses the open lock (`LockOpen`); Card’s “Lock it anytime” uses the closed lock (`Lock`).
