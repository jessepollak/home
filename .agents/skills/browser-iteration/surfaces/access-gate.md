### `access-gate`
- **Entry context**: access · `/access?next=%2Fhome` · anonymous (deployment gate; env-driven, app/access/page.tsx) · `HOME_ACCESS_PASSWORD` env (tests/browser/access.pw.ts) · protected request redirects to `/access`.

- **Live**: read-only
- **Owned paths**: `apps/web/app/access/**`, `apps/web/app/api/access/**`, `apps/web/server/access/**`
- **Reach** (smoke-verified): 1) clear cookies; goto `/home` (protected) → redirect `/access?next=%2Fhome`. 2) fill textbox `Access password`; wrong value → `Access denied. Try again.`; cookie `home-access` absent. 3) correct `HOME_ACCESS_PASSWORD` → `Continue` posts `/api/access`, then URL `/home` or `/?account=signin`. 4) heading `Access granted` on revisit; `Leave this deployment` posts `/api/access/logout` (no-JS form also asserted).
- **Verify**: manual
- **Expect**: headings `Enter access password` / `Access granted` (enabled) and `Access unavailable` (misconfigured); `Continue to Home` link after access is granted; CSP header `frame-ancestors 'none'` on the protected response (tests/browser/access.pw.ts); hydrated form marker `form[data-hydrated="true"]`.
- **States**: `misconfigured` → `Access unavailable` heading and `Access is temporarily unavailable.` alert; `disabled` → server redirect to the parsed safe `next` destination (unsafe or missing `next` defaults to `/`) (app/access/page.tsx).
- **Evidence**: screenshot; DOM snapshot; console/errors.
- **Owned by**: `apps/web/app/access/page.tsx`, `apps/web/server/access/*`, `/api/access`.
- **Unknowns**: cookie/secret names intentional; do not print credentials.
